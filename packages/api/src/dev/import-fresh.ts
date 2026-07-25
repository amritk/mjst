import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Options for {@link importFresh}.
 */
export type ImportFreshOptions = {
  /**
   * What a relative specifier resolves against. A **string** is treated as a
   * directory (defaults to `process.cwd()`, which is the project root when a
   * dev server is started with `bun dev.ts` / `node dev.js`); a **URL** — or a
   * `file:` string such as `import.meta.url` — resolves the way an import in
   * that file would.
   */
  readonly base?: string | URL
  /**
   * Re-evaluate the module's whole local graph, not just the module named
   * here. This needs `registerHooks` from `node:module` (Node 22.15+), and is
   * used automatically wherever it exists. Set `false` to keep the reload to
   * the named module — the modules it imports then keep the instances they
   * already had.
   */
  readonly graph?: boolean
  /**
   * The directory whose files take part in a graph reload. Files outside it,
   * and anything inside a `node_modules`, keep their loaded instances — so a
   * reload rebuilds your app without also re-evaluating your dependencies.
   * Defaults to the resolved {@link ImportFreshOptions.base} directory.
   */
  readonly root?: string
}

/**
 * The query parameter that makes each reload a distinct module URL. ESM has no
 * cache invalidation, so a fresh key is the only portable way to re-evaluate a
 * module — the same trick every JS dev server plays.
 */
const HOT_PARAM = '__mjst_hot'

/** Node's synchronous resolve hook, typed minimally — we only touch `url`. */
type ResolvedModule = {
  url: string
  format?: string | null
  shortCircuit?: boolean
  importAttributes?: Record<string, string>
}

type ResolveContext = {
  conditions: string[]
  importAttributes: Record<string, string>
  parentURL?: string
}

/** The rest of the resolve chain, which Node hands to every hook. */
type NextResolve = (specifier: string, context: ResolveContext) => ResolvedModule

type ResolveHook = (specifier: string, context: ResolveContext, next: NextResolve) => ResolvedModule

/**
 * `node:module` as far as we care about it. `registerHooks` is Node-only
 * (22.15+) and missing on Bun, so it is optional and reached through a
 * namespace import — a named import would throw at load time where it does
 * not exist.
 */
type ModuleHooks = { registerHooks?: (hooks: { resolve?: ResolveHook }) => unknown }

/** Bumped on every call, so each reload gets module URLs nothing has loaded yet. */
let generation = 0

/**
 * Where the installed hook stamps. Kept in a mutable module variable rather
 * than captured in the closure because the hook can only be installed once,
 * while callers may reload from different roots over the process lifetime —
 * the most recent root wins.
 */
let graphRoot: string | undefined

/** `undefined` until we have tried; then whether this runtime supports the hook. */
let graphHooks: boolean | undefined

/** A trailing slash keeps the prefix test on directory boundaries, so `/app` cannot match `/app-old`. */
const directoryHref = (path: string): string => {
  const href = pathToFileURL(path).href
  return href.endsWith('/') ? href : `${href}/`
}

/**
 * Installs the resolve hook that carries the reload generation into every
 * local import, which is what makes a reload reach the *whole* graph: the
 * entry re-evaluates because its URL changed, and each module it imports
 * re-evaluates because the hook changed theirs too. Dependencies are left
 * alone — anything in a `node_modules`, or outside `root`, keeps the instance
 * it already had.
 */
const installGraphHooks = async (root: string): Promise<boolean> => {
  graphRoot = root
  if (graphHooks !== undefined) return graphHooks

  const moduleApi = (await import('node:module')) as ModuleHooks
  if (typeof moduleApi.registerHooks !== 'function') {
    graphHooks = false
    return false
  }

  moduleApi.registerHooks({
    resolve: (specifier, context, nextResolve) => {
      const resolved = nextResolve(specifier, context)
      const scope = graphRoot
      if (scope === undefined) return resolved
      if (!resolved.url.startsWith(directoryHref(scope)) || resolved.url.includes('/node_modules/')) return resolved

      const url = new URL(resolved.url)
      url.searchParams.set(HOT_PARAM, String(generation))
      return { ...resolved, url: url.href }
    },
  })
  graphHooks = true
  return true
}

/** Resolves `specifier` the way an import inside `base` would. */
const toFileUrl = (specifier: string | URL, base: string | URL): URL => {
  if (specifier instanceof URL) return new URL(specifier.href)
  if (specifier.startsWith('file:')) return new URL(specifier)
  if (base instanceof URL) return new URL(specifier, base)
  if (base.startsWith('file:')) return new URL(specifier, base)
  return pathToFileURL(resolve(base, specifier))
}

/**
 * The specifier to import the target under this generation. Bun keys its
 * module cache on the file path and ignores a `file:` URL's query, so the
 * plain path form is the one both runtimes see as a module they have not
 * loaded — while a Windows path is not a valid specifier at all, so those keep
 * the URL form (Node, which busts on the query either way, is what runs
 * there).
 */
const freshSpecifier = (target: URL): string => {
  const path = fileURLToPath(target)
  if (!path.startsWith('/')) {
    const url = new URL(target.href)
    url.searchParams.set(HOT_PARAM, String(generation))
    return url.href
  }
  return `${path}?${HOT_PARAM}=${generation}`
}

/**
 * Imports a module as if the process had never seen it — the reload half of
 * {@link createHotApi}, and the only part of a hot reload that has to fight
 * the runtime, since ESM caches modules by URL for the life of the process.
 *
 * Pass it your routes module: every call re-evaluates that module (and, where
 * the runtime supports it, every local module it imports) so the API rebuilds
 * from the code on disk right now.
 *
 * Two things are worth knowing before you lean on it. Reloaded modules get
 * **fresh instances**, so anything that must survive a reload — a connection
 * pool, an in-memory store, a counter — belongs outside them (on `globalThis`,
 * or in a module outside `root`). And it is a **development** tool: each
 * generation leaves the previous module instances in memory, which is exactly
 * what you want while editing and never what you want in production.
 *
 * @example
 * ```typescript
 * const api = await createHotApi({
 *   load: async () => {
 *     const routes = await importFresh<typeof import('./src/routes')>('./src/routes.ts')
 *     return { routes: Object.values(routes) }
 *   },
 *   watch: watchPaths('src'),
 * })
 * ```
 */
export const importFresh = async <T = Record<string, unknown>>(
  specifier: string | URL,
  options: ImportFreshOptions = {},
): Promise<T> => {
  const base = options.base ?? process.cwd()
  const target = toFileUrl(specifier, base)

  generation += 1

  if (options.graph !== false) {
    // A URL base points at a file, not a directory, so it cannot double as the
    // graph root — the project root is the better guess there.
    const root = options.root ?? (typeof base === 'string' && !base.startsWith('file:') ? base : process.cwd())
    await installGraphHooks(resolve(root))
  }

  // The entry is stamped here as well as by the hook: the hook only touches
  // files under `root`, and a routes module kept somewhere else should still
  // reload. It is also what carries the reload on runtimes with no hook at all.
  return (await import(freshSpecifier(target))) as T
}
