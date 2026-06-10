import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { buildSchema } from '../src/index.ts'
import { LIBRARY_IDS, LIBRARY_LABELS, type LibraryId } from './parsers.ts'
import { PARSE_CASES } from './schemas.ts'
import type { WorkerResult } from './worker.ts'

/**
 * Reliable replication of the "parseSafe" half of
 * `moltar/typescript-runtime-type-benchmarks` for this repo's pure parsers
 * (mjst, zod, typebox): assert the types, strip undeclared keys, and return a
 * clean typed object.
 *
 * Reliability is the point — the same isolation + statistics methodology as the
 * validators benchmark:
 *
 *   - **Isolation** — every (case, library) pair is timed in its own freshly
 *     spawned process (`worker.ts`). One library's JIT state and GC never touch
 *     another's, matching upstream's "isolated node processes" switch.
 *   - **Statistics** — each worker takes many timed trials and reports the
 *     median plus the spread, so a number is only trusted when it's stable. A `~`
 *     flag marks any measurement that wobbled more than 10%.
 *
 * We report steady-state parse throughput (parser already prepared) and the cold
 * "prepare a parser" cost, which only mjst pays — its codegen — since zod and
 * TypeBox author/interpret their parsers with no separate build step.
 */

const WORKER = fileURLToPath(new URL('./worker.ts', import.meta.url))
const BENCH_DIR = fileURLToPath(new URL('.', import.meta.url))

const fmt = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(1)
}

const pad = (s: string, width: number): string => s.padEnd(width)
const padStart = (s: string, width: number): string => s.padStart(width)

/** A coefficient of variation above this is flagged as a noisy (less trustworthy) sample. */
const NOISY_SPREAD = 0.1

/** Throughput + stability for one cell of the table. */
const cell = (median: number, spread: number): string => {
  const flag = spread > NOISY_SPREAD ? '~' : ' '
  return `${flag}${fmt(median)} (±${(spread * 100).toFixed(0)}%)`
}

/** Spawns an isolated worker to time one library against one case. */
const runWorker = (caseName: string, lib: LibraryId): WorkerResult => {
  // `--conditions development` resolves the `@amritk/*` workspace packages to
  // their TypeScript sources (no build step needed).
  const stdout = execFileSync(process.execPath, ['--conditions', 'development', WORKER, caseName, lib], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    cwd: BENCH_DIR,
  })
  return JSON.parse(stdout) as WorkerResult
}

/** Times the cold cost of producing a ready-to-run parser, averaged over runs. */
const prepareMs = async (prepare: () => unknown | Promise<unknown>, iterations = 50): Promise<number> => {
  for (let i = 0; i < 5; i++) await prepare()
  const start = performance.now()
  for (let i = 0; i < iterations; i++) await prepare()
  return (performance.now() - start) / iterations
}

const run = async (): Promise<void> => {
  console.log('\n=== @amritk/generate-parsers vs zod vs typebox (parseSafe: assert + strip) ===\n')
  console.log(`Node/Bun: ${typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : process.version}`)
  console.log('Each library is timed in an isolated process; ±n% is the coefficient of variation,')
  console.log('and ~ flags a sample whose CV exceeded 10% (treat it as less trustworthy).')
  console.log('All parsers strip undeclared keys (mjst via strict + stripUnknown) and throw on bad types.\n')

  for (const parseCase of PARSE_CASES) {
    console.log(`## ${parseCase.name}\n`)

    const results = new Map<LibraryId, WorkerResult>()
    for (const lib of LIBRARY_IDS) results.set(lib, runWorker(parseCase.name, lib))

    const parity = LIBRARY_IDS.map((lib) => `${LIBRARY_LABELS[lib]}=${results.get(lib)?.parityDetail}`).join('  ')
    console.log(`  parity: ${parity}`)
    for (const lib of LIBRARY_IDS) {
      if (!results.get(lib)?.parityOk)
        console.log(`  ⚠ ${LIBRARY_LABELS[lib]} disagreed (wrong strip or accepted invalid)`)
    }
    console.log('')

    console.log(`  ${pad('parser', 24)}${padStart('parse ops/s', 20)}`)
    for (const lib of LIBRARY_IDS) {
      const r = results.get(lib)
      if (!r) continue
      console.log(`  ${pad(LIBRARY_LABELS[lib], 24)}${padStart(cell(r.valid.median, r.valid.spread), 20)}`)
    }

    // Headline ratio: mjst vs zod, the canonical parse-and-strip library.
    const mjst = results.get('mjst')?.valid.median ?? 0
    const zod = results.get('zod')?.valid.median ?? 0
    if (mjst > 0 && zod > 0) {
      const ratio = mjst / zod
      const verb = ratio >= 1 ? `${ratio.toFixed(2)}x faster than` : `${(1 / ratio).toFixed(2)}x slower than`
      console.log(`\n  → mjst is ${verb} zod on valid input`)
    }

    // Cold "prepare a parser" cost. Only mjst has a build step (codegen); zod and
    // TypeBox author/interpret with no compile, so there is nothing to time.
    const mjstGen = await prepareMs(() =>
      buildSchema(parseCase.schema, parseCase.typeName, undefined, false, false, true, 'package', './', false, true),
    )
    console.log('\n  prepare-a-parser cost (one-shot):')
    console.log(`    mjst codegen (source)   ${mjstGen.toFixed(3)} ms`)
    console.log('    zod authoring           n/a (no build step)')
    console.log('    typebox                 n/a (interpreted; no compile step)')
    console.log('')
  }
}

await run()
