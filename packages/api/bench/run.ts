import type { ApiRequest } from '../src/index.ts'
import { createApi, defineRoute } from '../src/index.ts'

/**
 * Measures the per-request overhead of the whole pipeline (routing + coercion
 * + validation + dispatch) against a bare async function, so the framework tax
 * is visible in isolation from any HTTP transport.
 *
 * Run with: bun run bench
 */
const throughput = async (fn: () => Promise<unknown>, budgetMs = 600): Promise<number> => {
  // Warmup lets the engine tier the code up before we start timing.
  const warmupEnd = performance.now() + 100
  while (performance.now() < warmupEnd) await fn()

  let ops = 0
  const start = performance.now()
  const end = start + budgetMs
  while (performance.now() < end) {
    // Batch to amortize the clock read.
    for (let i = 0; i < 100; i++) await fn()
    ops += 100
  }
  return Math.round((ops / (performance.now() - start)) * 1000)
}

const userBody = {
  type: 'object',
  properties: { id: { type: 'integer' }, name: { type: 'string' }, email: { type: 'string' } },
  required: ['id', 'name'],
} as const

const routes = [
  defineRoute({
    method: 'get',
    path: '/health',
    responses: { 200: { body: { type: 'object', properties: { ok: { type: 'boolean' } } } } },
    handler: () => ({ status: 200, body: { ok: true } }),
  }),
  defineRoute({
    method: 'get',
    path: '/users/{id}',
    request: {
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      query: { type: 'object', properties: { verbose: { type: 'boolean' } } },
    },
    responses: { 200: { body: userBody } },
    handler: ({ params }) => ({ status: 200, body: { id: params.id, name: 'Ada' } }),
  }),
  defineRoute({
    method: 'post',
    path: '/users',
    request: { body: userBody },
    responses: { 201: { body: userBody } },
    handler: ({ body }) => ({ status: 201, body }),
  }),
]

const api = createApi({ routes })

const request = (method: string, path: string, search = '', body?: unknown): ApiRequest => ({
  method,
  path,
  searchParams: () => new URLSearchParams(search),
  header: () => undefined,
  readBody: () => Promise.resolve(body),
})

const staticRequest = request('GET', '/health')
const dynamicRequest = request('GET', '/users/42', 'verbose=true')
const postRequest = request('POST', '/users', '', { id: 1, name: 'Ada', email: 'ada@example.com' })

const bareHandler = async (): Promise<unknown> => ({ status: 200, body: { ok: true } })

const cases: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ['bare async handler (baseline)', bareHandler],
  ['static route, no validation', () => api.handle(staticRequest)],
  ['dynamic route + params/query validation', () => api.handle(dynamicRequest)],
  ['post route + body validation', () => api.handle(postRequest)],
]

for (const [name, fn] of cases) {
  const ops = await throughput(fn)
  console.log(`${name.padEnd(42)} ${ops.toLocaleString('en-US').padStart(12)} ops/s`)
}
