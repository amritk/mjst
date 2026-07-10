import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveRefs } from '@amritk/resolve-refs'

import type { LintResolver } from '../src/core'
import { lint } from '../src/index'
import { createOpenApiRuleset } from '../src/rules/openapi/index'

/**
 * Benchmarks the end-to-end `mjst lint` path over real-world OpenAPI documents:
 * parse (with a source map) → dereference `$ref`s → run the recommended OpenAPI
 * ruleset. The specs — Swagger's petstore, the DigitalOcean API, and the OpenAI
 * API — are the actual fixtures the test suite lints, spanning ~17 KB to ~2.8 MB
 * so the numbers cover both a small config and a genuinely large document.
 *
 * Two things are timed separately, because they answer different questions:
 *
 *   - **build** — assembling the ruleset once (`createOpenApiRuleset`): compiling
 *     every rule's JSONPath expression and wiring up the functions/formats. A
 *     process pays this once, then lints many documents against the result, so it
 *     is reported on its own rather than folded into per-document throughput.
 *   - **lint** — one full `lint()` call against a prepared ruleset, with an
 *     in-memory `$ref` resolver (the linter's real default: rules marked
 *     `resolved: true` see through references). This is the representative "how
 *     fast does mjst lint my spec" number — parse, dereference, and every rule.
 *
 * Each measurement warms up (to let V8 optimise the hot paths), times a single
 * run to size the sample, then reports the mean over a fixed time budget. Timing
 * a whole `lint()` — I/O-free, already-in-memory — means the figures are
 * dominated by real work: JSONPath matching, the built-in/OpenAPI functions, and
 * the dereference pass. Micro-benchmark figures vary by machine and runtime —
 * reproduce with `bun run bench`.
 */

const FIXTURE_DIR = fileURLToPath(new URL('../../../fixtures/openapi/real-world/', import.meta.url))

type Fixture = { label: string; file: string }

const FIXTURES: Fixture[] = [
  { label: 'petstore (Swagger)', file: 'swagger-petstore.json' },
  { label: 'digitalocean', file: 'digitalocean.yaml' },
  { label: 'openai', file: 'openai.yaml' },
]

/** In-memory resolver backed by `@amritk/resolve-refs` — the same dereferencing `mjst lint` does for internal refs. */
const resolver: LintResolver = (document) => ({ resolved: resolveRefs(document.data, {}).resolved })

type Timing = { meanMs: number; iterations: number }

/**
 * Warms `fn` up, times one run to size the sample, then reports the mean over
 * roughly `budgetMs` (clamped to a sane iteration count so the big document
 * still runs a few times and the small one does not run forever).
 */
const measure = async (
  fn: () => Promise<unknown> | unknown,
  budgetMs = 2000,
  maxIterations = 1000,
): Promise<Timing> => {
  for (let i = 0; i < 3; i++) await fn()

  const probeStart = performance.now()
  await fn()
  const single = performance.now() - probeStart

  const iterations = Math.max(3, Math.min(maxIterations, Math.round(budgetMs / Math.max(single, 0.02))))
  const start = performance.now()
  for (let i = 0; i < iterations; i++) await fn()
  return { meanMs: (performance.now() - start) / iterations, iterations }
}

const pad = (s: string, width: number): string => s.padEnd(width)
const padStart = (s: string, width: number): string => s.padStart(width)

const fmtMs = (ms: number): string =>
  ms >= 100 ? `${ms.toFixed(0)} ms` : ms >= 1 ? `${ms.toFixed(1)} ms` : `${ms.toFixed(3)} ms`
/** Throughput in MB of source linted per second — a size-independent way to compare documents. */
const fmtThroughput = (bytes: number, ms: number): string => `${(bytes / 1_000_000 / (ms / 1000)).toFixed(1)} MB/s`

const run = async (): Promise<void> => {
  console.log('\n=== @amritk/lint — recommended OpenAPI ruleset over real-world specs ===\n')
  console.log(`Node/Bun: ${typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : process.version}`)
  console.log('build = assemble the ruleset once   lint = one full parse → resolve → rules pass')
  console.log('$refs are dereferenced in memory, as the mjst lint default does.\n')

  // One-shot: assembling the recommended ruleset (compiles every JSONPath, wires functions/formats).
  const build = await measure(() => void createOpenApiRuleset(), 1000, 500)
  console.log(`ruleset build (one-shot): ${fmtMs(build.meanMs)}\n`)

  const ruleset = createOpenApiRuleset()

  console.log(
    `  ${pad('document', 22)}${padStart('size', 10)}${padStart('findings', 10)}${padStart('lint', 12)}${padStart('throughput', 14)}`,
  )

  for (const { label, file } of FIXTURES) {
    const input = readFileSync(`${FIXTURE_DIR}${file}`, 'utf8')
    const bytes = Buffer.byteLength(input, 'utf8')

    const findings = (await lint(input, { ruleset, resolve: resolver, source: file })).length
    const timing = await measure(() => lint(input, { ruleset, resolve: resolver, source: file }))

    console.log(
      `  ${pad(label, 22)}${padStart(`${(bytes / 1024).toFixed(0)} KB`, 10)}${padStart(String(findings), 10)}${padStart(fmtMs(timing.meanMs), 12)}${padStart(fmtThroughput(bytes, timing.meanMs), 14)}`,
    )
  }

  console.log('\n  lint is the mean wall time of one full parse → resolve → rules pass over the whole document.\n')
}

await run()
