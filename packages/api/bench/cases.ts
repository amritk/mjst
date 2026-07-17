import type { ApiRequest } from '../src/index.ts'

/**
 * The benchmark case table, shared by three consumers: the manual bench
 * (`run.ts`), the isolated per-case worker CI spawns (`worker.ts`), and the
 * PR delta harness (`scripts/bench-compare.ts`) — which imports this module
 * *only for the case names*. Everything heavy therefore loads lazily inside
 * `setup`: importing the table costs nothing and works without built
 * workspace packages, while workers resolve the real code under
 * `--conditions development`.
 *
 * A prepared case is one request through the pipeline, resolving to the
 * response status (the escaping value `measureAsync` folds into its sink).
 */
export type PreparedCase = () => Promise<number>

export type ApiBenchCase = {
  readonly name: string
  readonly setup: () => Promise<PreparedCase>
}

/** The framework-neutral request the runtime cases feed to `api.handle`. */
const request = (method: string, path: string, search = '', body?: unknown): ApiRequest => ({
  method,
  path,
  searchParams: () => new URLSearchParams(search),
  // The raw-string fast path, like the real adapters provide.
  queryString: () => search,
  header: () => undefined,
  readBody: () => Promise.resolve(body),
  readText: () => Promise.resolve(JSON.stringify(body)),
  readBytes: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(body))),
})

const runtimeApi = async (): Promise<{ handle: ApiHandle }> => {
  const { createApi } = await import('../src/index.ts')
  const routes = await import('./routes.ts')
  return createApi({ routes: Object.values(routes) })
}

type ApiHandle = (request: ApiRequest) => Promise<{ status: number }>
type CompiledFetch = (request: Request) => Response | Promise<Response>

/**
 * Emits the compiled engine for the same routes into `bench/.fixtures/` and
 * imports it — the production configuration, timed Request → Response.
 * Memoized so `run.ts` compiles once across its compiled cases; workers run
 * one case per process anyway.
 */
let compiled: Promise<CompiledFetch> | undefined
const compiledFetch = (): Promise<CompiledFetch> => {
  compiled ??= (async () => {
    const { compileToModule } = await import('../src/index.ts')
    const routes = await import('./routes.ts')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '.fixtures')
    mkdirSync(fixtureDir, { recursive: true })
    const modulePath = join(fixtureDir, 'generated-bench.ts')
    writeFileSync(
      modulePath,
      compileToModule({
        routesImport: '../routes.ts',
        runtimeImport: '../../src/index.ts',
        validatorsImport: '@amritk/runtime-validators',
        routes: { health: routes.health, getUser: routes.getUser, createUser: routes.createUser },
      }),
    )
    // A computed specifier keeps type checkers away from a module that only
    // exists after this setup ran (same trick as the differential test).
    const module = (await import(modulePath)) as { fetch: CompiledFetch }
    return module.fetch
  })()
  return compiled
}

const POST_BODY = JSON.stringify({ id: 1, name: 'Ada', email: 'ada@example.com' })

export const API_BENCH_CASES: readonly ApiBenchCase[] = [
  {
    name: 'static GET (runtime)',
    setup: async () => {
      const api = await runtimeApi()
      const staticRequest = request('GET', '/health')
      return () => api.handle(staticRequest).then((response) => response.status)
    },
  },
  {
    name: 'dynamic GET, params+query validated (runtime)',
    setup: async () => {
      const api = await runtimeApi()
      const dynamicRequest = request('GET', '/users/42', 'verbose=true')
      return () => api.handle(dynamicRequest).then((response) => response.status)
    },
  },
  {
    name: 'POST, body validated (runtime)',
    setup: async () => {
      const api = await runtimeApi()
      const postRequest = request('POST', '/users', '', { id: 1, name: 'Ada', email: 'ada@example.com' })
      return () => api.handle(postRequest).then((response) => response.status)
    },
  },
  {
    name: 'static GET (compiled)',
    setup: async () => {
      const handler = await compiledFetch()
      // A fresh Request per op, like a real runtime delivers — its
      // construction cost is part of what the compiled engine competes on.
      return async () => {
        const response = await handler(new Request('http://localhost/health'))
        return response.status
      }
    },
  },
  {
    name: 'POST, body validated (compiled)',
    setup: async () => {
      const handler = await compiledFetch()
      return async () => {
        const response = await handler(
          new Request('http://localhost/users', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: POST_BODY,
          }),
        )
        return response.status
      }
    },
  },
]
