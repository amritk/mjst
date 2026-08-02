import { Miniflare } from 'miniflare'

import { CASES } from './stacks.ts'

/**
 * Why the `@amritk/api` columns get paused more than Hono under workerd, in
 * two measurements the timing table cannot make.
 *
 * **Bytes allocated per request.** workerd's inspector answers
 * `Runtime.getHeapUsage` with real numbers, so the driver reads the isolate's
 * heap either side of a run of exactly N requests (`/run?ops=N`). A single
 * before/after pair would be worthless — the Miniflare loopback hop that
 * *delivers* the request allocates too, and a garbage collection anywhere in
 * the window erases the evidence. So each column is measured at several op
 * counts and the deltas are regressed against N: the slope is bytes per
 * request and the intercept absorbs the fixed per-dispatch cost, whatever it
 * is. Points where the heap shrank (a collection landed mid-run) are dropped
 * rather than averaged in, and the fit quality is reported so a bad regression
 * cannot be read as a result.
 *
 * workerd accepts `HeapProfiler.startSampling` but returns an empty profile —
 * the domain is stubbed, so there is no per-call-frame attribution to be had
 * from the runtime. The regression gives the total; `bench/stacks.ts` and the
 * engine sources are where the total gets attributed.
 *
 * **Pause frequency.** `/pauses` times fixed batches of requests inside the
 * isolate and reports the median batch, how many batches ran more than twice
 * that, and what share of the wall clock those stalled batches took. This is
 * the claim the README makes, measured directly instead of inferred from the
 * spread between a column's slowest and fastest trial.
 *
 * One fresh isolate per measurement, exactly like `bench/run-workerd.ts`: a
 * reused isolate carries its heap into the next reading, which is precisely
 * what this is trying to measure.
 *
 * Run with: bun run bench:workerd:allocations
 */

const WORKER = './bench/.fixtures/workerd-bench.mjs'
const INSPECTOR_PORT = 9329

/**
 * Op counts the regression is taken over, and how many readings each one gets.
 *
 * These are deliberately small. A window only measures the engine if no
 * collection lands inside it, and the columns that allocate most are exactly
 * the ones that collect soonest — at 4000 requests every window on the
 * `@amritk/api` columns contained a collection and the fit was meaningless.
 * Small windows sampled many times give the same slope with points that
 * survive.
 */
const OP_COUNTS = [100, 200, 400, 800] as const
const READINGS_PER_COUNT = 15

type HeapUsage = { readonly usedSize: number }

type Inspector = {
  readonly heapUsed: () => Promise<number>
  readonly close: () => void
}

/** A CDP client for the worker's isolate, with only the calls this driver needs. */
const connectInspector = async (): Promise<Inspector> => {
  const targets = (await (await fetch(`http://127.0.0.1:${INSPECTOR_PORT}/json`)).json()) as ReadonlyArray<{
    id: string
    webSocketDebuggerUrl: string
  }>
  const target = targets.find((candidate) => candidate.id.startsWith('core:user:'))
  if (target === undefined) throw new Error(`no core:user target among ${targets.map((t) => t.id).join(', ')}`)

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('inspector socket failed')))
  })

  const pending = new Map<number, (result: unknown) => void>()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown }
    if (message.id !== undefined) pending.get(message.id)?.(message.result)
  })

  let nextId = 0
  const send = (method: string): Promise<unknown> => {
    const id = ++nextId
    return new Promise((resolve) => {
      pending.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params: {} }))
    })
  }

  return {
    heapUsed: async () => ((await send('Runtime.getHeapUsage')) as HeapUsage).usedSize,
    close: () => socket.close(),
  }
}

/** One isolate, with the inspector attached, for the duration of `body`. */
const withIsolate = async <T>(body: (dispatch: (path: string) => Promise<unknown>, inspector: Inspector) => Promise<T>): Promise<T> => {
  const mf = new Miniflare({
    modules: true,
    scriptPath: WORKER,
    compatibilityDate: '2025-01-01',
    compatibilityFlags: ['nodejs_compat'],
    inspectorPort: INSPECTOR_PORT,
  })
  try {
    await mf.ready
    const dispatch = async (path: string): Promise<unknown> => {
      const response = await mf.dispatchFetch(`http://localhost${path}`)
      const body = await response.json()
      if (!response.ok) throw new Error(`worker replied ${response.status}: ${JSON.stringify(body)}`)
      return body
    }
    const inspector = await connectInspector()
    try {
      return await body(dispatch, inspector)
    } finally {
      inspector.close()
    }
  } finally {
    await mf.dispose()
  }
}

type Point = { readonly ops: number; readonly bytes: number }

/**
 * Least-squares slope and its coefficient of determination. The slope is bytes
 * per request; r² says whether the points actually lie on a line, which is the
 * only thing that makes the slope meaningful.
 */
const fit = (points: readonly Point[]): { readonly bytesPerOp: number; readonly r2: number } => {
  const n = points.length
  const meanOps = points.reduce((sum, point) => sum + point.ops, 0) / n
  const meanBytes = points.reduce((sum, point) => sum + point.bytes, 0) / n
  const covariance = points.reduce((sum, point) => sum + (point.ops - meanOps) * (point.bytes - meanBytes), 0)
  const variance = points.reduce((sum, point) => sum + (point.ops - meanOps) ** 2, 0)
  const bytesPerOp = variance === 0 ? 0 : covariance / variance
  const intercept = meanBytes - bytesPerOp * meanOps
  const residual = points.reduce((sum, point) => sum + (point.bytes - (intercept + bytesPerOp * point.ops)) ** 2, 0)
  const total = points.reduce((sum, point) => sum + (point.bytes - meanBytes) ** 2, 0)
  return { bytesPerOp, r2: total === 0 ? 0 : 1 - residual / total }
}

/** The middle value, for collapsing repeated readings without letting one outlier win. */
const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/**
 * Bytes per request for one column on one case.
 *
 * Each op count gets its own isolate, and inside it the same window is read
 * many times over. A window whose heap went backwards had a collection land
 * inside it — that delta measures the collector, not the engine, so it is
 * dropped and the median of the survivors stands for the window. Regressing
 * those medians against the op count cancels the constant cost of the dispatch
 * and the heap read alike, leaving the slope: bytes per request.
 */
const bytesPerRequest = async (
  columnIndex: number,
  caseIndex: number,
): Promise<{ readonly bytesPerOp: number; readonly r2: number; readonly kept: number }> => {
  const points: Point[] = []
  for (const ops of OP_COUNTS) {
    const clean = await withIsolate(async (dispatch, inspector) => {
      // A priming run so the isolate is past its first-call lazy work before
      // any reading counts; otherwise the smallest window carries all of it.
      await dispatch(`/run?column=${columnIndex}&case=${caseIndex}&ops=500`)
      const deltas: number[] = []
      let previous = await inspector.heapUsed()
      for (let reading = 0; reading < READINGS_PER_COUNT; reading++) {
        await dispatch(`/run?column=${columnIndex}&case=${caseIndex}&ops=${ops}`)
        const current = await inspector.heapUsed()
        if (current > previous) deltas.push(current - previous)
        previous = current
      }
      return deltas
    })
    if (clean.length > 0) points.push({ ops, bytes: median(clean) })
  }
  if (points.length < 3) return { bytesPerOp: Number.NaN, r2: 0, kept: points.length }
  return { ...fit(points), kept: points.length }
}

const parity = (await withIsolate(async (dispatch) => dispatch('/parity'))) as { columns: readonly string[] }

const pad = (value: string, width: number): string => value.padEnd(width)
const padStart = (value: string, width: number): string => value.padStart(width)

console.log('\n=== @amritk/api vs hono — allocation and pause behaviour inside workerd ===\n')
console.log(`Runtime: workerd (Miniflare), driven from ${typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : 'Node'}`)
console.log('Bytes/req is the slope of heap growth against request count, taken over')
console.log(`op counts ${OP_COUNTS.join(', ')} in fresh isolates; r² is the fit quality.`)
console.log('Stalled batches are batches of 2048 requests that ran more than 2x the')
console.log("median batch — the pause claim, measured rather than inferred.\n")

const staticCaseIndex = CASES.findIndex((benchCase) => benchCase.label === 'static GET')
const caseIndex = staticCaseIndex === -1 ? 0 : staticCaseIndex
console.log(`Case: ${CASES[caseIndex]?.label}\n`)

console.log(
  `  ${pad('column', 26)}${padStart('bytes/req', 12)}${padStart('r²', 8)}${padStart('median batch', 14)}${padStart('stalled', 10)}${padStart('stall share', 13)}`,
)
for (const [columnIndex, label] of parity.columns.entries()) {
  const allocation = await bytesPerRequest(columnIndex, caseIndex)
  const pauses = (await withIsolate(async (dispatch) =>
    dispatch(`/pauses?column=${columnIndex}&case=${caseIndex}`),
  )) as {
    batches: number
    medianBatchMs: number
    stalledBatches: number
    stalledMsShare: number
  }
  console.log(
    `  ${pad(label, 26)}${padStart(Number.isNaN(allocation.bytesPerOp) ? 'n/a' : Math.round(allocation.bytesPerOp).toString(), 12)}${padStart(allocation.r2.toFixed(2), 8)}${padStart(`${pauses.medianBatchMs.toFixed(2)} ms`, 14)}${padStart(`${pauses.stalledBatches}/${pauses.batches}`, 10)}${padStart(`${(pauses.stalledMsShare * 100).toFixed(0)}%`, 13)}`,
  )
}
console.log('')
