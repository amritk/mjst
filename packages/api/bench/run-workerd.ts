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

type Measurement = { readonly median: number; readonly max: number }

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

console.log('\n=== @amritk/api vs hono — Request → Response, inside workerd ===\n')
console.log(`Runtime: workerd (Miniflare), driven from ${typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : 'Node'}`)
console.log("Each cell is a fresh isolate, timed from inside, so Miniflare's loopback hop")
console.log('is excluded. "peak" is the fastest of the timed trials — the rate a column')
console.log('reaches when workerd is not pausing it.\n')

console.log(`  ${pad('case', 32)}${parity.columns.map((label) => padStart(label, 26)).join('')}`)
for (const [caseIndex, benchCase] of CASES.entries()) {
  const cells: string[] = []
  for (const columnIndex of parity.columns.keys()) {
    const stats = (await measure(`/measure?column=${columnIndex}&case=${caseIndex}`)) as Measurement
    cells.push(padStart(`${ops(stats.median)} ops/s (peak ${ops(stats.max)})`, 26))
  }
  console.log(`  ${pad(benchCase.label, 32)}${cells.join('')}`)
}
console.log('')
console.log('The gap between median and peak is the finding: workerd pauses the @amritk/api')
console.log('columns far more often than it pauses Hono, while their peak rates are close.\n')
