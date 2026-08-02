import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { createApi, toFetchHandler } from '../src/index.ts'
import { measureAsync } from './measure.ts'
import * as routes from './routes.ts'

/**
 * The cross-framework table in the README: `Request` → `Response` through the
 * stack a Workers app would actually deploy, for the same three routes on
 * every column.
 *
 * `bench/run.ts` times the engine in isolation (a framework-neutral
 * `ApiRequest` straight into `api.handle`) — deliberately, so a routing or
 * coercion regression shows up undiluted. That makes its numbers useless for
 * comparing against another framework, which has no such seam: Hono only ever
 * sees a `Request`. So this file pays the web-standard object cost on every
 * column and compares like for like.
 *
 * Columns:
 *   - **hono** — routing and dispatch, no validation at all.
 *   - **hono + zod** — the same routes with `@hono/zod-validator` on params,
 *     query, and body: the closest thing to a like-for-like validated stack.
 *   - **runtime engine (dev)** — `toFetchHandler(createApi({ … }))`, response
 *     validation included, which is how the docs tell you to run development.
 *   - **compiled engine (prod)** — the module `compileToModule` emits.
 *
 * It runs under **Node** by default, not Bun: workerd runs V8, so V8 is the
 * engine the headline numbers should come from. `bench/emit-compiled.ts`
 * prepares the compiled engine as a Node-loadable bundle first, and the run
 * script bundles this file the same way — see `bench:vs:build` in
 * package.json. The same bundle runs under either engine, and the two
 * disagree enough to be worth reporting separately: undici's `Request` costs
 * far more to build than JavaScriptCore's, and every column pays it.
 *
 * Run with: bun run bench:vs (Node) or bun run bench:vs:bun
 */

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

type FetchLike = (request: Request) => Response | Promise<Response>

/** Hono with no validation: routing, dispatch, and JSON serialization only. */
const honoBare = (): FetchLike => {
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
const honoZod = (): FetchLike => {
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
const mjstRuntime = (): FetchLike => {
  const api = createApi({ routes: Object.values(routes), validateResponses: true })
  return toFetchHandler(api)
}

/**
 * The production engine, bundled to `.mjs` by `bench/emit-compiled.ts`. The
 * specifier is computed so type checkers leave a module that only exists
 * after that step alone (same trick as bench/cases.ts) — and so the bundler
 * leaves it as a run-time import rather than inlining it.
 */
const mjstCompiled = async (): Promise<FetchLike> => {
  // Sibling lookup: `bench:vs` bundles this file into `.fixtures/` alongside
  // the compiled engine, so both live in the same directory when it runs.
  const modulePath = join(dirname(fileURLToPath(import.meta.url)), 'generated-vs-frameworks.mjs')
  const module = (await import(modulePath)) as { fetch: FetchLike }
  return module.fetch
}

type Column = { readonly label: string; readonly handler: FetchLike }

const columns: readonly Column[] = [
  { label: 'hono (no validation)', handler: honoBare() },
  { label: 'hono + zod', handler: honoZod() },
  { label: 'runtime engine (dev)', handler: mjstRuntime() },
  { label: 'compiled engine (prod)', handler: await mjstCompiled() },
]

const cases = [
  { label: 'static GET', request: () => new Request('http://localhost/health'), expect: 200 },
  {
    label: 'dynamic GET, params validated',
    request: () => new Request('http://localhost/users/42?verbose=true'),
    expect: 200,
  },
  { label: 'POST, body validated', request: postRequest, expect: 201 },
] as const

// Parity first: a column that answers differently isn't doing the same job,
// and timing it would compare two different pieces of work.
for (const benchCase of cases) {
  for (const column of columns) {
    const response = await column.handler(benchCase.request())
    if (response.status !== benchCase.expect) {
      throw new Error(
        `${column.label} answered ${response.status} on "${benchCase.label}", expected ${benchCase.expect}`,
      )
    }
  }
}

const pad = (value: string, width: number): string => value.padEnd(width)
const padStart = (value: string, width: number): string => value.padStart(width)
const ops = (value: number): string =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : `${Math.round(value / 1000)}k`

console.log('\n=== @amritk/api vs hono — Request → Response, same three routes ===\n')
console.log(`Runtime: ${typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : `Node ${process.version}`}`)
console.log('Every column is timed on the same web-standard Request objects; ±n% is the')
console.log('coefficient of variation over the timed trials.\n')

console.log(`  ${pad('case', 32)}${columns.map((column) => padStart(column.label, 26)).join('')}`)
for (const benchCase of cases) {
  const cells: string[] = []
  for (const column of columns) {
    // A longer warmup and trial budget than the defaults: these cases build a
    // web-standard Request per op, and under Node that allocation makes the
    // samples drift until the JIT and GC have settled.
    const stats = await measureAsync(async () => (await column.handler(benchCase.request())).status, {
      warmupMs: 1500,
      trialBudgetMs: 250,
    })
    cells.push(padStart(`${ops(stats.median)} ops/s (±${(stats.spread * 100).toFixed(0)}%)`, 26))
  }
  console.log(`  ${pad(benchCase.label, 32)}${cells.join('')}`)
}
console.log('')
