import { createApi } from '../create-api'
import type { AnyRouteContract, Api, ApiOptions, ApiResponse, OpenApiDocument } from '../types'
import type { Watcher } from './watch-paths'

/**
 * What a successful reload reports. `generation` starts at 1 for the first
 * build, so a log line doubles as a count of how many times the API has been
 * rebuilt in this process.
 */
export type HotReload = {
  readonly generation: number
  readonly durationMs: number
  readonly routes: number
  readonly changed: readonly string[]
}

/**
 * Options for {@link createHotApi}.
 */
export type HotApiOptions = {
  /**
   * Builds the API. Runs once at startup and again on every reload, so it has
   * to re-read your routes rather than close over them — {@link importFresh}
   * is the piece that makes that possible. Return {@link ApiOptions} and the
   * hot API calls `createApi` for you, or return an {@link Api} you built
   * yourself when the options are assembled somewhere else.
   */
  readonly load: () => Api | ApiOptions | Promise<Api | ApiOptions>
  /**
   * What triggers a reload. {@link watchPaths} covers the filesystem; leave it
   * out and reloads only happen when you call {@link HotApi.reload} — which is
   * what you want when your bundler or test already knows when to reload.
   */
  readonly watch?: Watcher
  /** Runs after a successful swap. Replaces the default log line. */
  readonly onReload?: (event: HotReload) => void
  /** Runs when a reload fails. Replaces the default error log. */
  readonly onReloadError?: (error: unknown, changed: readonly string[]) => void
  /** Set `false` to silence the built-in logging. Ignored where you passed your own callback. */
  readonly log?: boolean
}

/**
 * A stable {@link Api} whose routes are swapped underneath it. Hand it to
 * `toFetchHandler` / `toNodeHandler` once at startup and never think about it
 * again — every request routes through whatever the last successful reload
 * built.
 */
export type HotApi = Api & {
  /**
   * Rebuilds the API now. Resolves `true` when the new build took over and
   * `false` when it failed (the previous build keeps serving). Reloads never
   * reject and never overlap: calls arriving mid-rebuild share one follow-up
   * pass, so a burst of edits costs one extra build.
   */
  readonly reload: (changed?: readonly string[]) => Promise<boolean>
  /** Stops watching. Idempotent — the API keeps serving its last build. */
  readonly close: () => void
  /** How many successful builds this API has had; `0` while the first one is still failing. */
  readonly generation: () => number
  /** The error from the last failed reload, or `undefined` when the last one succeeded. */
  readonly error: () => unknown
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * What every request gets before the first successful build. A dev server that
 * refuses to start because of a typo is a dev server you have to restart by
 * hand, so it binds its port, serves the reason, and picks up the fix on the
 * next save.
 */
const notLoaded = (error: unknown): ApiResponse => ({
  status: 503,
  headers: { 'cache-control': 'no-store', 'retry-after': '1' },
  body: {
    error: 'not_loaded',
    message:
      error === undefined
        ? 'The API has not finished loading yet.'
        : `The API failed to load: ${message(error)}. Fix the error and save — the next reload picks it up.`,
  },
})

/**
 * Wraps a hot-reloading development API around your routes: the server keeps
 * its socket, its process, and everything living outside the reloaded modules,
 * while the route table, validators, and OpenAPI document are rebuilt from the
 * code on disk whenever it changes.
 *
 * This is the development counterpart to the compiled engine — the runtime
 * engine already rebuilds in milliseconds, so a reload is a `createApi` call
 * rather than a restart, and in-flight requests finish against the build they
 * started on. The swap is atomic: the new API only takes over once it has been
 * built successfully, and a broken edit leaves the previous one serving with
 * the error logged (`api.error()` has it too, if you would rather render it).
 *
 * Keep it out of production: it holds every generation of your route modules
 * in memory, and `createApi`'s startup checks — duplicate routes, unsecured
 * routes — are worth failing a deploy over rather than logging.
 *
 * @example
 * ```typescript
 * // dev.ts — bun dev.ts, node dev.js, deno run dev.ts
 * import { toFetchHandler } from '@amritk/api'
 * import { createHotApi, importFresh, watchPaths } from '@amritk/api/dev'
 *
 * const api = await createHotApi({
 *   load: async () => {
 *     const routes = await importFresh<typeof import('./src/routes')>('./src/routes.ts')
 *     return { routes: Object.values(routes), validateResponses: true }
 *   },
 *   watch: watchPaths('src'),
 * })
 *
 * Bun.serve({ port: 3000, fetch: toFetchHandler(api) })
 * ```
 */
export const createHotApi = async (options: HotApiOptions): Promise<HotApi> => {
  const log = options.log !== false

  let current: Api | undefined
  let failure: unknown
  let builds = 0

  // One rebuild at a time, and at most one queued behind it: reloads that
  // arrive while a build is running share a single follow-up pass instead of
  // stacking one build per event.
  let running: Promise<boolean> | undefined
  let queued: Promise<boolean> | undefined
  const pending = new Set<string>()

  const build = async (): Promise<boolean> => {
    queued = undefined
    const changed = [...pending]
    pending.clear()

    const startedAt = performance.now()
    try {
      const loaded = await options.load()
      // A load that returned a ready-made Api is used as is; anything else is
      // options we build here, which is where duplicate/unsecured routes throw.
      current = typeof (loaded as Api).handle === 'function' ? (loaded as Api) : createApi(loaded as ApiOptions)
      failure = undefined
      builds += 1

      const event: HotReload = {
        generation: builds,
        durationMs: performance.now() - startedAt,
        routes: current.routes.length,
        changed,
      }
      if (options.onReload !== undefined) options.onReload(event)
      else if (log) {
        console.log(`[api] reloaded ${event.routes} route(s) in ${event.durationMs.toFixed(1)}ms`)
      }
      return true
    } catch (error) {
      failure = error
      if (options.onReloadError !== undefined) options.onReloadError(error, changed)
      else if (log) {
        console.error(
          current === undefined
            ? '[api] load failed — serving 503 until it succeeds'
            : '[api] reload failed — keeping the previous routes',
          error,
        )
      }
      return false
    }
  }

  const run = (): Promise<boolean> => {
    const started = build()
    running = started.finally(() => {
      running = undefined
    })
    return running
  }

  const reload = (changed: readonly string[] = []): Promise<boolean> => {
    for (const file of changed) pending.add(file)
    // Mid-build callers wait for the pass that will see their changes, not the
    // one already in flight — which was built from the files as they were.
    if (running === undefined) return run()
    queued ??= running.then(() => run())
    return queued
  }

  await reload()

  const dispose = options.watch?.((changed) => {
    void reload(changed)
  })

  // `openApi` has to return a document or nothing at all, so an unloaded API
  // throws with the load failure attached rather than inventing an empty one.
  const openApi = (): OpenApiDocument => {
    if (current === undefined) {
      throw new Error(
        failure === undefined
          ? 'The API has not loaded yet, so there is no OpenAPI document to build.'
          : `The API failed to load, so there is no OpenAPI document to build: ${message(failure)}`,
        failure === undefined ? undefined : { cause: failure },
      )
    }
    return current.openApi()
  }

  let closed = false

  return {
    handle: async (request, env, executionContext) =>
      current === undefined ? notLoaded(failure) : current.handle(request, env, executionContext),
    // Before the first build there is nothing to match against, and answering
    // "no" would let a middleware-style adapter pass the request through as if
    // the route did not exist — the 503 explaining why is far more useful.
    matches: (method, path) => (current === undefined ? true : current.matches(method, path)),
    openApi,
    get routes(): ReadonlyArray<AnyRouteContract> {
      return current?.routes ?? []
    },
    reload,
    close: () => {
      if (closed) return
      closed = true
      dispose?.()
    },
    generation: () => builds,
    error: () => failure,
  }
}
