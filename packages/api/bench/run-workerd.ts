import { Miniflare } from 'miniflare'

import { CASES } from './stacks.ts'

/**
 * Runs the cross-framework benchmark inside **workerd** — the runtime
 * `compileToModule` is built for — via Miniflare, which is the same binary
 * Wrangler runs locally.
 *
 * Two things make the numbers mean something:
 *
 *   - **The measurement loop runs inside the isolate**
 *     (`bench/workerd-handler.ts`). Timing from out here would measure
 *     Miniflare's loopback HTTP hop instead of the framework. workerd's clock
 *     is coarsened to 1 ms, which is fine for 100 ms trials, and locally it is
 *     not frozen between I/O the way production is.
 *   - **One fresh isolate per measurement.** This mirrors what the other bench
 *     suites in this repo do with processes, and here it is not optional: a
 *     reused isolate hands its heap state to the next measurement, and the
 *     numbers move 30-40% depending on what ran before them.
 *
 * Run with: bun run bench:workerd
 */

const WORKER = './bench/.fixtures/workerd-bench.mjs'

type Measurement = { readonly median: number; readonly min: number; readonly max: number }

/**
 * One measurement in its own isolate. workerd refuses a script path that
 * climbs out of its starting directory, so this has to run with the package
 * as cwd — which `bun run` guarantees.
 */
const measure = async (path: string): Promise<unknown> => {
  const mf = new Miniflare({
    modules: true,
    scriptPath: WORKER,
    compatibilityDate: '2025-01-01',
    compatibilityFlags: ['nodejs_compat'],
  })
  try {
    const response = await mf.dispatchFetch(`http://localhost${path}`)
    const body = await response.json()
    if (!response.ok) throw new Error(`worker replied ${response.status}: ${JSON.stringify(body)}`)
    return body
  } finally {
    await mf.dispose()
  }
}

const parity = (await measure('/parity')) as { columns: readonly string[] }

const pad = (value: string, width: number): string => value.padEnd(width)
const padStart = (value: string, width: number): string => value.padStart(width)
const ops = (value: number): string =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : `${Math.round(value / 1000)}k`

/**
 * How many fresh isolates each cell is measured in. The median over a single
 * isolate's trials is already robust to the odd paused trial, but isolates
 * differ from one another by more than that — repeating the whole measurement
 * and taking the median of the per-isolate medians is what makes a cell
 * reproducible run to run. `REPEATS` on the environment overrides it.
 */
const REPEATS = Number(process.env['REPEATS'] ?? 5)

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

console.log('\n=== @amritk/api vs hono — Request → Response, inside workerd ===\n')
console.log(`Runtime: workerd (Miniflare), driven from ${typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : 'Node'}`)
console.log("Each cell is a fresh isolate, timed from inside, so Miniflare's loopback hop")
console.log(`is excluded, repeated in ${REPEATS} isolates. Each cell reads "median [lowest..`)
console.log('highest]" over those per-isolate medians, so the bracket is how much the')
console.log('cell moves between isolates rather than between trials.\n')

console.log(`  ${pad('case', 32)}${parity.columns.map((label) => padStart(label, 30)).join('')}`)
for (const [caseIndex, benchCase] of CASES.entries()) {
  const cells: string[] = []
  for (const columnIndex of parity.columns.keys()) {
    const medians: number[] = []
    for (let repeat = 0; repeat < REPEATS; repeat++) {
      const stats = (await measure(`/measure?column=${columnIndex}&case=${caseIndex}`)) as Measurement
      medians.push(stats.median)
    }
    const sorted = [...medians].sort((a, b) => a - b)
    cells.push(
      padStart(`${ops(median(medians))} [${ops(sorted[0] ?? 0)}..${ops(sorted[sorted.length - 1] ?? 0)}]`, 30),
    )
  }
  console.log(`  ${pad(benchCase.label, 32)}${cells.join('')}`)
}
console.log('')
