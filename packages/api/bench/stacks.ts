import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { createApi, toFetchHandler } from '../src/index.ts'
import * as routes from './routes.ts'

/**
 * The stacks and the cases behind the cross-framework table — shared by every
 * runtime that table is measured on, so a column can't drift between them.
 * `bench/vs-frameworks.ts` runs them under Node and Bun; the worker entry
 * `bench/emit-compiled.ts` generates runs them inside workerd.
 *
 * Everything here is web-standard: `Request` in, `Response` out, no Node
 * built-ins, because workerd has none.
 */

export type FetchLike = (request: Request) => Response | Promise<Response>

export type Column = { readonly label: string; readonly handler: FetchLike }

const USER_BODY = { id: 1, name: 'Ada', email: 'ada@example.com' }
const POST_BODY = JSON.stringify(USER_BODY)

const postRequest = (): Request =>
  new Request('http://localhost/users', {
    method: 'POST',
    // Server runtimes deliver content-length on incoming fixed-size bodies,
    // and the capped reader's fast path keys on it — so it belongs here.
    headers: { 'content-type': 'application/json', 'content-length': String(POST_BODY.length) },
    body: POST_BODY,
  })

/** Hono with no validation: routing, dispatch, and JSON serialization only. */
export const honoBare = (): FetchLike => {
  const app = new Hono()
  app.get('/health', (c) => c.json({ ok: true }))
  app.get('/users/:id', (c) => c.json({ id: Number(c.req.param('id')), name: 'Ada' }))
  app.post('/users', async (c) => c.json((await c.req.json()) as unknown, 201))
  return (request) => app.fetch(request)
}

/**
 * Hono with `@hono/zod-validator` on every slot the mjst contracts declare.
 * The coercions mirror the JSON Schema ones: path params and query strings
 * arrive as strings and have to be turned into an integer and a boolean.
 */
export const honoZod = (): FetchLike => {
  const params = z.object({ id: z.coerce.number().int() })
  const query = z.object({
    verbose: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  })
  const body = z.object({ id: z.number().int(), name: z.string(), email: z.string().optional() })

  const app = new Hono()
  app.get('/health', (c) => c.json({ ok: true }))
  app.get('/users/:id', zValidator('param', params), zValidator('query', query), (c) =>
    c.json({ id: c.req.valid('param').id, name: 'Ada' }),
  )
  app.post('/users', zValidator('json', body), (c) => c.json(c.req.valid('json'), 201))
  return (request) => app.fetch(request)
}

/** The development engine, response validation on, behind the fetch adapter. */
export const mjstRuntime = (): FetchLike => {
  const api = createApi({ routes: Object.values(routes), validateResponses: true })
  return toFetchHandler(api)
}

/** Assembles the four columns; the compiled engine is built per runtime. */
export const buildColumns = (compiled: FetchLike): readonly Column[] => [
  { label: 'hono (no validation)', handler: honoBare() },
  { label: 'hono + zod', handler: honoZod() },
  { label: 'runtime engine (dev)', handler: mjstRuntime() },
  { label: 'compiled engine (prod)', handler: compiled },
]

export const CASES = [
  { label: 'static GET', request: () => new Request('http://localhost/health'), expect: 200 },
  {
    label: 'dynamic GET, params validated',
    request: () => new Request('http://localhost/users/42?verbose=true'),
    expect: 200,
  },
  { label: 'POST, body validated', request: postRequest, expect: 201 },
] as const

/**
 * Parity gate: a column that answers differently isn't doing the same job,
 * and timing it would compare two different pieces of work.
 */
export const assertParity = async (columns: readonly Column[]): Promise<void> => {
  for (const benchCase of CASES) {
    for (const column of columns) {
      const response = await column.handler(benchCase.request())
      if (response.status !== benchCase.expect) {
        throw new Error(
          `${column.label} answered ${response.status} on "${benchCase.label}", expected ${benchCase.expect}`,
        )
      }
    }
  }
}

/**
 * The measurement budget, shared so every runtime is timed the same way:
 * these cases build a web-standard Request per op, and that allocation makes
 * samples drift until the JIT and GC have settled.
 */
export const MEASURE_OPTIONS = { warmupMs: 1500, trialBudgetMs: 250 } as const
