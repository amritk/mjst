import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { measureAsync } from './measure.ts'
import { assertParity, buildColumns, CASES, type FetchLike, MEASURE_OPTIONS } from './stacks.ts'

/**
 * The cross-framework table in the README: `Request` → `Response` through the
 * stack a Workers app would actually deploy, for the same three routes on
 * every column. The columns themselves live in `bench/stacks.ts`, shared with
 * the workerd run.
 *
 * `bench/run.ts` times the engine in isolation (a framework-neutral
 * `ApiRequest` straight into `api.handle`) — deliberately, so a routing or
 * coercion regression shows up undiluted. That makes its numbers useless for
 * comparing against another framework, which has no such seam: Hono only ever
 * sees a `Request`. So this file pays the web-standard object cost on every
 * column and compares like for like.
 *
 * This entry point covers the two general-purpose runtimes. workerd — the one
 * that actually matters for a Workers deployment — is measured by
 * `bench/run-workerd.ts`, which runs the same stacks inside the real runtime.
 * `bench/emit-compiled.ts` prepares the compiled engine as a loadable bundle
 * first, and the run script bundles this file the same way; see
 * `bench:vs:build` in package.json.
 *
 * Run with: bun run bench:vs (Node) or bun run bench:vs:bun
 */

/**
 * The production engine, bundled to `.mjs` by `bench/emit-compiled.ts`. The
 * specifier is computed so type checkers leave a module that only exists
 * after that step alone — and so the bundler leaves it as a run-time import
 * rather than inlining it.
 */
const mjstCompiled = async (): Promise<FetchLike> => {
  // Sibling lookup: `bench:vs` bundles this file into `.fixtures/` alongside
  // the compiled engine, so both live in the same directory when it runs.
  const modulePath = join(dirname(fileURLToPath(import.meta.url)), 'generated-vs-frameworks.mjs')
  const module = (await import(modulePath)) as { fetch: FetchLike }
  return module.fetch
}

const columns = buildColumns(await mjstCompiled())
await assertParity(columns)

const pad = (value: string, width: number): string => value.padEnd(width)
const padStart = (value: string, width: number): string => value.padStart(width)
const ops = (value: number): string =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : `${Math.round(value / 1000)}k`

console.log('\n=== @amritk/api vs hono — Request → Response, same three routes ===\n')
console.log(`Runtime: ${typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : `Node ${process.version}`}`)
console.log('Every column is timed on the same web-standard Request objects; ±n% is the')
console.log('coefficient of variation over the timed trials.\n')

console.log(`  ${pad('case', 32)}${columns.map((column) => padStart(column.label, 26)).join('')}`)
for (const benchCase of CASES) {
  const cells: string[] = []
  for (const column of columns) {
    const stats = await measureAsync(async () => (await column.handler(benchCase.request())).status, MEASURE_OPTIONS)
    cells.push(padStart(`${ops(stats.median)} ops/s (±${(stats.spread * 100).toFixed(0)}%)`, 26))
  }
  console.log(`  ${pad(benchCase.label, 32)}${cells.join('')}`)
}
console.log('')
