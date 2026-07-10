import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveRefs } from '@amritk/resolve-refs'
import { Spectral, Document as SpectralDocument } from '@stoplight/spectral-core'
import { Json as SpectralJson, Yaml as SpectralYaml } from '@stoplight/spectral-parsers'
import { oas as spectralOas } from '@stoplight/spectral-rulesets'

import type { LintResolver } from '../src/core'
import { lint } from '../src/index'
import { createOpenApiRuleset } from '../src/rules/openapi/index'

/**
 * Benchmarks `@amritk/lint` head-to-head against **Spectral** — the OpenAPI
 * linter this package is modelled on (hence the `spectral:oas` alias) — over
 * real-world specs. Both lint the same fixtures (Swagger's petstore, the
 * DigitalOcean API, the OpenAI API — ~17 KB to ~2.8 MB) with their respective
 * *recommended OpenAPI ruleset*, doing the same job: parse a document, resolve
 * its internal `$ref`s, and run the full preset.
 *
 * Two things are timed separately, because they answer different questions:
 *
 *   - **build** — assembling the ruleset once (mjst's `createOpenApiRuleset`
 *     vs `new Spectral()` + `setRuleset(oas)`): compiling every rule's JSONPath
 *     and wiring up functions/formats. A process pays this once, then lints many
 *     documents, so it is reported on its own.
 *   - **lint** — one full pass over a document: parse → dereference `$ref`s →
 *     run every rule. mjst dereferences in memory via `@amritk/resolve-refs`
 *     (the linter's real default); Spectral uses its own default resolver. A
 *     fresh document is parsed each iteration on both sides, matching how the
 *     tools are actually called.
 *
 * The two rulesets are *not* byte-identical — rule implementations and `$ref`
 * resolution differ — so the finding counts differ and this is a **throughput**
 * comparison, not a correctness parity check. Each count is printed so the work
 * each tool did is visible. Spectral's JSONPath engine (`nimma`) currently
 * throws on the 2.8 MB OpenAI spec under Bun, so that row is mjst-only; the
 * Spectral side is guarded and reports `errored` rather than aborting the run.
 *
 * Each measurement warms up (to let V8 optimise the hot paths), times a single
 * run to size the sample, then reports the mean over a fixed time budget.
 * Micro-benchmark figures vary by machine and runtime — reproduce with
 * `bun run bench`.
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

/** A tool's result on one document: its finding count and mean lint time, or an error marker. */
type Sample = { findings: number; meanMs: number } | { error: string }

/** Runs `count` + `measure` for a tool, catching a throw (e.g. Spectral's nimma engine) into an error marker. */
const sample = async (count: () => Promise<number>, time: () => Promise<unknown>): Promise<Sample> => {
  try {
    const findings = await count()
    const { meanMs } = await measure(time)
    return { findings, meanMs }
  } catch (error) {
    return { error: error instanceof Error ? error.name : 'error' }
  }
}

const pad = (s: string, width: number): string => s.padEnd(width)
const padStart = (s: string, width: number): string => s.padStart(width)

const fmtMs = (ms: number): string =>
  ms >= 100 ? `${ms.toFixed(0)} ms` : ms >= 1 ? `${ms.toFixed(1)} ms` : `${ms.toFixed(3)} ms`

const run = async (): Promise<void> => {
  console.log('\n=== @amritk/lint vs Spectral — recommended OpenAPI ruleset over real-world specs ===\n')
  console.log(`Node/Bun: ${typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : process.version}`)
  console.log('build = assemble the ruleset once   lint = one full parse → resolve → rules pass')
  console.log('Finding counts differ (the rulesets are not byte-identical); this is a throughput comparison.\n')

  // One-shot ruleset build: mjst compiles JSONPath + wires functions/formats; Spectral compiles its ruleset.
  const mjstBuild = await measure(() => void createOpenApiRuleset(), 1000, 500)
  const spectralBuild = await measure(
    () => {
      const s = new Spectral()
      s.setRuleset(spectralOas as never)
    },
    1000,
    500,
  )
  console.log(`ruleset build (one-shot):  mjst ${fmtMs(mjstBuild.meanMs)}   spectral ${fmtMs(spectralBuild.meanMs)}\n`)

  const ruleset = createOpenApiRuleset()
  const spectral = new Spectral()
  spectral.setRuleset(spectralOas as never)

  console.log(
    `  ${pad('document', 22)}${padStart('size', 9)}${padStart('mjst', 11)}${padStart('spectral', 12)}${padStart('speedup', 10)}${padStart('findings m/s', 18)}`,
  )

  for (const { label, file } of FIXTURES) {
    const input = readFileSync(`${FIXTURE_DIR}${file}`, 'utf8')
    const kb = `${(Buffer.byteLength(input, 'utf8') / 1024).toFixed(0)} KB`
    const parser = file.endsWith('.json') ? SpectralJson : SpectralYaml

    const mjst = await sample(
      async () => (await lint(input, { ruleset, resolve: resolver, source: file })).length,
      () => lint(input, { ruleset, resolve: resolver, source: file }),
    )
    const spec = await sample(
      async () => (await spectral.run(new SpectralDocument(input, parser as never, file))).length,
      () => spectral.run(new SpectralDocument(input, parser as never, file)),
    )

    const mjstCell = 'error' in mjst ? mjst.error : fmtMs(mjst.meanMs)
    const specCell = 'error' in spec ? 'errored' : fmtMs(spec.meanMs)
    const speedup = 'error' in mjst || 'error' in spec ? '—' : `${(spec.meanMs / mjst.meanMs).toFixed(1)}x`
    const counts = `${'error' in mjst ? '—' : mjst.findings} / ${'error' in spec ? '—' : spec.findings}`

    console.log(
      `  ${pad(label, 22)}${padStart(kb, 9)}${padStart(mjstCell, 11)}${padStart(specCell, 12)}${padStart(speedup, 10)}${padStart(counts, 18)}`,
    )
  }

  console.log('\n  speedup is spectral ÷ mjst mean lint time; findings m/s is the mjst / spectral finding count.\n')
}

await run()
