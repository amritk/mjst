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
 * The pause histogram's shape. workerd's clock is quantized to 1 ms, so a batch
 * has to be long enough that the quantum is a rounding error rather than the
 * signal: 2048 requests runs ~20 ms at these rates, putting the quantum at
 * ~5%. 60 batches is a long enough sample for the tail to show up without the
 * whole sweep taking minutes. A batch more than twice the median counts as
 * stalled — far outside the batch-to-batch noise a clean run produces.
 */
const PAUSE_WARMUP_MS = 4000
const PAUSE_BATCHES = 60
const PAUSE_BATCH_OPS = 2048
const PAUSE_FACTOR = 2

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

    const column = columns[Number(url.searchParams.get('column'))]
    const benchCase = CASES[Number(url.searchParams.get('case'))]

    if (url.pathname === '/measure') {
      if (!column || !benchCase) return json({ error: 'column and case must index the tables' }, 400)
      const stats = await measureAsync(
        async () => (await column.handler(benchCase.request())).status,
        WORKERD_MEASURE_OPTIONS,
      )
      return json({ column: column.label, case: benchCase.label, ...stats })
    }

    // Exactly `ops` requests and nothing else — no timing, no warmup. The
    // allocation driver reads the isolate's heap either side of this and
    // regresses the delta against `ops`, so what matters is that the op count
    // is exact and the surrounding work is identical between calls.
    if (url.pathname === '/run') {
      if (!column || !benchCase) return json({ error: 'column and case must index the tables' }, 400)
      const ops = Number(url.searchParams.get('ops'))
      if (!Number.isInteger(ops) || ops < 0) return json({ error: 'ops must be a non-negative integer' }, 400)
      let sink = 0
      for (let i = 0; i < ops; i++) sink += (await column.handler(benchCase.request())).status
      return json({ ops, sink })
    }

    // The pause claim, measured rather than inferred: fixed-size batches, each
    // timed on its own. A column that is being paused shows the same median
    // batch as its rivals and a long tail of batches many times that.
    if (url.pathname === '/pauses') {
      if (!column || !benchCase) return json({ error: 'column and case must index the tables' }, 400)
      const warmupEnd = performance.now() + PAUSE_WARMUP_MS
      let sink = 0
      while (performance.now() < warmupEnd) sink += (await column.handler(benchCase.request())).status

      const batches: number[] = []
      for (let batch = 0; batch < PAUSE_BATCHES; batch++) {
        const start = performance.now()
        for (let i = 0; i < PAUSE_BATCH_OPS; i++) sink += (await column.handler(benchCase.request())).status
        batches.push(performance.now() - start)
      }
      if (!Number.isFinite(sink)) throw new Error('benchmark sink overflowed')

      const sorted = [...batches].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0
      const stalled = batches.filter((duration) => duration > median * PAUSE_FACTOR)
      const total = batches.reduce((sum, duration) => sum + duration, 0)
      return json({
        column: column.label,
        case: benchCase.label,
        batches: batches.length,
        batchOps: PAUSE_BATCH_OPS,
        medianBatchMs: median,
        slowestBatchMs: sorted[sorted.length - 1] ?? 0,
        stalledBatches: stalled.length,
        stalledMsShare: total > 0 ? stalled.reduce((sum, duration) => sum + duration, 0) / total : 0,
      })
    }

    return json({ error: `unknown path: ${url.pathname}` }, 404)
  }

  return { fetch }
}
