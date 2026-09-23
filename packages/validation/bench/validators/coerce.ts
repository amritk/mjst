import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { COERCE_CASES } from './coerce-cases.ts'
import type { WorkerResult } from './coerce-worker.ts'
import { ENGINE_IDS, ENGINE_LABELS, type EngineId, generateEngine, weigh } from './coercers.ts'
import { opsCell } from './measure.ts'

/**
 * Head-to-head: the two mjst code paths that turn unknown input into a typed
 * value. The parser engine in coercing mode against the validator engine's
 * `coerce` mode.
 *
 * This exists to answer a packaging question — whether the two generators are
 * one package wearing two names — so it reports the three things that decision
 * turns on:
 *
 *   - **Do they agree?** On input that can be made valid, both must land on the
 *     same document. On input that cannot, they part company by contract: the
 *     parser repairs toward defaults, the validator reports errors. The table
 *     prints both answers rather than picking one.
 *   - **What does each cost at steady state?** Timed across three input classes,
 *     because coercion cost is dominated by how much has to move: nothing
 *     (clean), every scalar (coercible), or a document that fails anyway.
 *   - **What does each cost cold?** Codegen time and the weight of the emitted
 *     source, which is what a consumer pays before any of the above applies.
 *
 * Methodology matches the other two benches in this repo: every (case, engine)
 * pair is timed in its own freshly spawned process, each worker takes many timed
 * trials and reports the median plus the spread, and a `~` flags any measurement
 * that wobbled more than 10%.
 */

const WORKER = fileURLToPath(new URL('./coerce-worker.ts', import.meta.url))
const BENCH_DIR = fileURLToPath(new URL('.', import.meta.url))

const pad = (s: string, width: number): string => s.padEnd(width)
const padStart = (s: string, width: number): string => s.padStart(width)

/**
 * Whether this process is Bun. The bench runs under either runtime: Bun resolves
 * the `@amritk/*` workspace packages to their TypeScript sources through the
 * `development` condition, while Node has no such loader and resolves them to
 * the built `dist` through the same exports map — so the flag is passed only
 * where it means something, and `bench:coerce:node` builds first.
 */
const IS_BUN = typeof Bun !== 'undefined'

/** Spawns an isolated worker to time one engine against one case. */
const runWorker = (caseName: string, engine: EngineId): WorkerResult => {
  const flags = IS_BUN ? ['--conditions', 'development'] : []
  const stdout = execFileSync(process.execPath, [...flags, WORKER, caseName, engine], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    cwd: BENCH_DIR,
  })
  return JSON.parse(stdout) as WorkerResult
}

/** Times the cold cost of generating one engine's source, averaged over runs. */
const generateMs = async (generate: () => Promise<unknown>, iterations = 50): Promise<number> => {
  for (let i = 0; i < 5; i++) await generate()
  const start = performance.now()
  for (let i = 0; i < iterations; i++) await generate()
  return (performance.now() - start) / iterations
}

/** A ratio, read out in whichever direction makes it a number above one. */
const compare = (mine: number, theirs: number): string => {
  const ratio = mine / theirs
  return ratio >= 1 ? `${ratio.toFixed(2)}x faster` : `${(1 / ratio).toFixed(2)}x slower`
}

const run = async (): Promise<void> => {
  console.log('\n=== parser engine (coercing) vs validator engine (coerce) vs ajv coerceTypes ===\n')
  console.log(`Node/Bun: ${IS_BUN ? `Bun ${Bun.version}` : process.version}`)
  console.log('Each engine is timed in an isolated process; ±n% is the coefficient of variation,')
  console.log('and ~ flags a sample whose CV exceeded 10% (treat it as less trustworthy).')
  console.log('clean = nothing to coerce, coercible = every number and boolean arrived as a string,')
  console.log('unrepairable = a document no coercion can make valid.\n')

  for (const coerceCase of COERCE_CASES) {
    console.log(`## ${coerceCase.name}\n`)

    const results = new Map<EngineId, WorkerResult>()
    for (const engine of ENGINE_IDS) results.set(engine, runWorker(coerceCase.name, engine))

    const agreed = ENGINE_IDS.every((engine) => results.get(engine)?.agreesOnValid === true)
    console.log(
      `  agreement: ${agreed ? 'every engine coerces clean and coercible input onto the same document ✓' : 'DISAGREE ✗'}`,
    )
    for (const engine of ENGINE_IDS) {
      if (results.get(engine)?.agreesOnValid === false) {
        console.log(`  ⚠ ${ENGINE_LABELS[engine]} did not land on the valid document`)
      }
    }
    console.log('')

    console.log(
      `  ${pad('engine', 32)}${padStart('clean ops/s', 20)}${padStart('coercible ops/s', 20)}${padStart('unrepairable ops/s', 22)}`,
    )
    for (const engine of ENGINE_IDS) {
      const r = results.get(engine)
      if (!r) continue
      const cells =
        padStart(opsCell(r.clean.median, r.clean.spread), 20) +
        padStart(opsCell(r.coercible.median, r.coercible.spread), 20) +
        padStart(opsCell(r.unrepairable.median, r.unrepairable.spread), 22)
      console.log(`  ${pad(ENGINE_LABELS[engine], 32)}${cells}`)
    }

    const parser = results.get('parser')
    const validator = results.get('validator')
    const ajv = results.get('ajv')
    if (validator && ajv) {
      console.log('')
      console.log(`  → coerceX is ${compare(validator.clean.median, ajv.clean.median)} than ajv on clean input`)
      console.log(
        `  → coerceX is ${compare(validator.coercible.median, ajv.coercible.median)} than ajv on coercible input`,
      )
      console.log(
        `  → coerceX is ${compare(validator.unrepairable.median, ajv.unrepairable.median)} than ajv on unrepairable input`,
      )
    }
    if (parser && validator) {
      console.log('')
      console.log(`  → parser is ${compare(parser.clean.median, validator.clean.median)} on clean input`)
      console.log(`  → parser is ${compare(parser.coercible.median, validator.coercible.median)} on coercible input`)
      console.log(
        `  → on unrepairable input the parser ${parser.unrepairableVerdict}s and the validator ${validator.unrepairableVerdict}s, ` +
          `${compare(parser.unrepairable.median, validator.unrepairable.median)}`,
      )
    }

    // The cold costs. Cheap and order-insensitive, so they stay in-process rather
    // than paying a spawn per measurement.
    console.log('\n  cold cost (one-shot codegen, and the source a consumer then ships):')
    console.log(
      `    ${pad('engine', 32)}${padStart('codegen', 12)}${padStart('per schema', 14)}${padStart('shared once', 14)}`,
    )
    // Ajv compiles at runtime with `new Function`, so it has no source to weigh.
    for (const engine of ENGINE_IDS) {
      if (engine === 'ajv') continue
      const { perSchema, shared } = weigh(await generateEngine(engine, coerceCase))
      const ms = await generateMs(() => generateEngine(engine, coerceCase))
      const cells =
        padStart(`${ms.toFixed(3)} ms`, 12) +
        padStart(`${(perSchema / 1024).toFixed(1)} KiB`, 14) +
        padStart(`${(shared / 1024).toFixed(1)} KiB`, 14)
      console.log(`    ${pad(ENGINE_LABELS[engine], 32)}${cells}`)
    }
    console.log('')
  }
}

await run()
