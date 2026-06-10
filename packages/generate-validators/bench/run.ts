import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'

import { buildValidatorSchema } from '../src/index.ts'
import { BENCH_CASES } from './schemas.ts'
import { LIBRARY_IDS, LIBRARY_LABELS, type LibraryId } from './validators.ts'
import type { WorkerResult } from './worker.ts'

/**
 * Reliable replication of the steady-state half of
 * `moltar/typescript-runtime-type-benchmarks` for this repo's four installed
 * libraries (mjst, ajv, typebox, zod).
 *
 * Reliability is the point. Two things make these numbers reproducible rather
 * than the run-to-run lottery a single shared-process loop produces:
 *
 *   - **Isolation** — every (case, library) pair is timed in its own freshly
 *     spawned process (`worker.ts`). One library's JIT state and GC never touch
 *     another's. This is the same fix upstream adopted ("isolated node
 *     processes for each benchmarked package").
 *   - **Statistics** — each worker takes many timed trials and reports the
 *     median plus the spread, so a number is only trusted when it's stable. The
 *     table prints the spread; a `~` flag marks any measurement that wobbled
 *     more than 15%.
 *
 * We report steady-state throughput (validator already prepared) and the cold
 * "prepare a validator" cost — codegen for mjst, compile for Ajv and TypeBox.
 */

const WORKER = fileURLToPath(new URL('./worker.ts', import.meta.url))

const fmt = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(1)
}

const pad = (s: string, width: number): string => s.padEnd(width)
const padStart = (s: string, width: number): string => s.padStart(width)

/** A spread above this fraction is flagged as a noisy (less trustworthy) sample. */
const NOISY_SPREAD = 0.15

/** Throughput + stability for one cell of the table. */
const cell = (median: number, spread: number): string => {
  const flag = spread > NOISY_SPREAD ? '~' : ' '
  return `${flag}${fmt(median)} (±${(spread * 100).toFixed(0)}%)`
}

/** Spawns an isolated worker to time one library against one case. */
const runWorker = (caseName: string, lib: LibraryId): WorkerResult => {
  const stdout = execFileSync(process.execPath, [WORKER, caseName, lib], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  })
  return JSON.parse(stdout) as WorkerResult
}

/** Times the cold cost of producing a ready-to-run validator, averaged over runs. */
const prepareMs = async (prepare: () => unknown | Promise<unknown>, iterations = 50): Promise<number> => {
  for (let i = 0; i < 5; i++) await prepare()
  const start = performance.now()
  for (let i = 0; i < iterations; i++) await prepare()
  return (performance.now() - start) / iterations
}

const makeAjv = (): Ajv => {
  const ajv = new Ajv({ strict: false })
  addFormats(ajv)
  return ajv
}

const run = async (): Promise<void> => {
  console.log('\n=== @amritk/generate-validators vs ajv vs typebox vs zod ===\n')
  console.log(`Node/Bun: ${typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : process.version}`)
  console.log('Each library is timed in an isolated process; ~ flags a sample that wobbled >15%.\n')

  for (const benchCase of BENCH_CASES) {
    console.log(`## ${benchCase.name}\n`)

    const results = new Map<LibraryId, WorkerResult>()
    for (const lib of LIBRARY_IDS) results.set(lib, runWorker(benchCase.name, lib))

    const parity = LIBRARY_IDS.map((lib) => `${LIBRARY_LABELS[lib]}=${results.get(lib)?.parityDetail}`).join('  ')
    console.log(`  parity (valid/invalid): ${parity}`)
    for (const lib of LIBRARY_IDS) {
      if (!results.get(lib)?.parityOk) console.log(`  ⚠ ${LIBRARY_LABELS[lib]} disagreed on a verdict`)
    }
    console.log('')

    console.log(`  ${pad('validator', 20)}${padStart('valid ops/s', 20)}${padStart('invalid ops/s', 20)}`)
    for (const lib of LIBRARY_IDS) {
      const r = results.get(lib)
      if (!r) continue
      const valid = padStart(cell(r.valid.median, r.valid.spread), 20)
      const invalid = padStart(cell(r.invalid.median, r.invalid.spread), 20)
      console.log(`  ${pad(LIBRARY_LABELS[lib], 20)}${valid}${invalid}`)
    }

    // Headline ratio for the steady-state goal: mjst vs the fastest compiled
    // checker (TypeBox) on the valid sample.
    const mjstValid = results.get('mjst')?.valid.median ?? 0
    const typeboxValid = results.get('typebox')?.valid.median ?? 0
    if (mjstValid > 0 && typeboxValid > 0) {
      const ratio = mjstValid / typeboxValid
      const verb = ratio >= 1 ? `${ratio.toFixed(2)}x faster than` : `${(1 / ratio).toFixed(2)}x slower than`
      console.log(`\n  → mjst is ${verb} typebox on valid input`)
    }

    // Cold "prepare a validator" cost. Cheap and order-insensitive, so it stays
    // in-process rather than paying a spawn per measurement.
    const mjstGen = await prepareMs(() => buildValidatorSchema(benchCase.schema, benchCase.typeName))
    const ajvCompile = await prepareMs(() => makeAjv().compile(benchCase.schema as object))
    const typeboxCompile = await prepareMs(() => TypeCompiler.Compile(benchCase.typebox))
    console.log('\n  prepare-a-validator cost (one-shot):')
    console.log(`    mjst codegen (source)   ${mjstGen.toFixed(3)} ms`)
    console.log(`    ajv compile             ${ajvCompile.toFixed(3)} ms`)
    console.log(`    typebox compile         ${typeboxCompile.toFixed(3)} ms`)
    console.log('    zod authoring           n/a (no build step)')
    console.log('')
  }
}

await run()
