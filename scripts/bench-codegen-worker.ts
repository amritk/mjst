import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { statsOf } from '../packages/generate-parsers/bench/measure.ts'

/**
 * One isolated codegen measurement for `bench-compare.ts`: times `buildSchema`
 * from the given checkout and prints median ms per parser as JSON. Spawned as
 * a fresh process per (tree, case) — with `--conditions development` so an
 * unbuilt checkout resolves its workspace deps to TypeScript sources — so the
 * two trees' JIT states never touch and the numbers are comparable.
 *
 *   usage: bun --conditions development scripts/bench-codegen-worker.ts <treeDir> <mode> <schemaJson>
 *
 * This script lives in the head tree but is pointed at either tree via
 * `treeDir`; it only calls the long-stable positional prefix of `buildSchema`,
 * so it works against older checkouts too.
 */

const [tree, mode, schemaJson] = process.argv.slice(2) as [string, string, string]

const { buildSchema } = (await import(pathToFileURL(join(tree, 'packages/generate-parsers/src/index.ts')).href)) as {
  buildSchema: (...args: unknown[]) => Promise<unknown>
}
const schema = JSON.parse(schemaJson) as unknown

const build = (): Promise<unknown> =>
  buildSchema(schema, 'Bench', undefined, false, false, true, 'package', './', false, mode === 'safe')

// Warm up untimed, then take timed windows (like the throughput benches'
// measure.ts): a single buildSchema is ~0.1ms, far below timer jitter, so
// fixed iteration counts produce CVs of 30-50%. Each window runs until a
// ~150ms budget elapses and reports ms per call.
const warmupEnd = performance.now() + 300
while (performance.now() < warmupEnd) await build()

const samples: number[] = []
for (let t = 0; t < 9; t++) {
  let ops = 0
  const start = performance.now()
  const end = start + 150
  do {
    for (let i = 0; i < 25; i++) await build()
    ops += 25
  } while (performance.now() < end)
  samples.push((performance.now() - start) / ops)
}

// The shared statistics core: median over all windows (robust to GC stalls),
// spread over the trimmed samples so a single stall doesn't mark an otherwise
// stable run as noisy.
const { median, spread } = statsOf(samples, { trimOutliers: true })

process.stdout.write(JSON.stringify({ median, spread }))
