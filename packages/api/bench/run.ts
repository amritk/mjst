import { API_BENCH_CASES } from './cases.ts'
import { measureAsync } from './measure.ts'

/**
 * Runs every benchmark case in-process for quick local numbers — routing +
 * coercion + validation + dispatch through the runtime engine, and
 * Request → Response through the compiled engine — next to a bare async
 * function so the framework tax is visible in isolation.
 *
 * Run with: bun run bench
 *
 * CI numbers come from the same case table via `bench/worker.ts` (one
 * isolated process per case, spawned by scripts/bench-compare.ts), so a case
 * added here automatically appears in the PR delta table.
 */
const bare = async (): Promise<number> => 200

const print = (name: string, median: number, spread: number): void => {
  const ops = Math.round(median).toLocaleString('en-US')
  console.log(`${name.padEnd(46)} ${ops.padStart(12)} ops/s  ±${(spread * 100).toFixed(0)}%`)
}

const baseline = await measureAsync(bare)
print('bare async handler (baseline)', baseline.median, baseline.spread)

for (const benchCase of API_BENCH_CASES) {
  const op = await benchCase.setup()
  const stats = await measureAsync(op)
  print(benchCase.name, stats.median, stats.spread)
}
