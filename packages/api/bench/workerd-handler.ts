import { measureAsync } from './measure.ts'
import { assertParity, buildColumns, CASES, type FetchLike } from './stacks.ts'

/**
 * More, shorter trials than the other runtimes get. workerd runs the isolate
 * under a memory cap, and a benchmark that allocates a `Request` per op hits
 * GC often enough that a few long trials swing wildly; many short ones spread
 * those pauses across the sample so the median means something.
 */
const WORKERD_MEASURE_OPTIONS = { warmupMs: 4000, trials: 41, trialBudgetMs: 100 } as const

/**
 * The cross-framework benchmark as a Worker.
 *
 * workerd is the runtime `compileToModule` exists for, so it is the runtime
 * the compiled engine should be measured in — not a stand-in that happens to
 * share an engine. Timing from outside would measure a loopback socket
 * instead of the framework, so the measurement loop runs *inside* the
 * isolate: `bench/run-workerd.ts` asks for one (column, case) pair per
 * request and the handler returns the same statistics the other runtimes
 * report.
 *
 * (workerd freezes its clock between I/O in production, which would make this
 * impossible. Locally it does not, and the numbers below are wall-clock
 * measured inside the isolate — verified against the outer request duration.)
 *
 * The compiled engine is passed in rather than imported: it only exists after
 * `bench/emit-compiled.ts` has generated it, and the generated worker entry is
 * what wires the two together.
 */
export const createBenchHandler = (compiled: FetchLike): { fetch: FetchLike } => {
  const columns = buildColumns(compiled)

  const fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

    if (url.pathname === '/parity') {
      await assertParity(columns)
      return json({ ok: true, columns: columns.map((column) => column.label), cases: CASES.map((c) => c.label) })
    }

    if (url.pathname !== '/measure') return json({ error: `unknown path: ${url.pathname}` }, 404)

    const column = columns[Number(url.searchParams.get('column'))]
    const benchCase = CASES[Number(url.searchParams.get('case'))]
    if (!column || !benchCase) return json({ error: 'column and case must index the tables' }, 400)

    const stats = await measureAsync(
      async () => (await column.handler(benchCase.request())).status,
      WORKERD_MEASURE_OPTIONS,
    )
    return json({ column: column.label, case: benchCase.label, ...stats })
  }

  return { fetch }
}
