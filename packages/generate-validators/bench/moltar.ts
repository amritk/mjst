import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildValidatorSchema } from '../src/index.ts'
import { fmtOps } from './measure.ts'
import { assertSchema, isStrictCase, MOLTAR_CASES } from './moltar-data.mjs'

/**
 * The same validators as `run.ts`, measured under
 * `moltar/typescript-runtime-type-benchmarks`' harness instead of this repo's.
 *
 * Why this exists: the two harnesses disagree by roughly an order of magnitude
 * on the same function, and a README that quotes one while naming the other is
 * not comparing like with like. `run.ts` times a validator directly over a pool
 * of distinct inputs and reports the median of 21 trials. The leaderboard runs
 * benny (benchmark.js) over moltar's `Benchmark` class — every operation is a
 * call into a compiled benchmark loop, then a call through a class property,
 * around a fixture that is a single frozen module-level constant whose verdict
 * is thrown away. That harness has a ceiling, and near the top of the table the
 * ceiling is what gets measured.
 *
 * So this table always carries the control that makes the ceiling visible:
 *
 *   - a **no-op** row — a validator that checks nothing. Nothing measured under
 *     this harness can honestly exceed it, and anything close to it is reporting
 *     benny's per-operation cost rather than validation cost.
 *   - **discarded vs observed** — upstream's `run()` throws the verdict away,
 *     which lets V8 delete the call outright; observing it in the same shape
 *     shows how much of the "throughput" was elimination.
 *
 * Both runtimes are measured when both are installed: the public leaderboard
 * publishes Node numbers, this repo benches on Bun, and that difference is worth
 * a column rather than a hand-wave.
 *
 *   bun run bench:moltar
 */

const BENCH_DIR = fileURLToPath(new URL('.', import.meta.url))
const WORKER = join(BENCH_DIR, 'moltar-worker.mjs')
const OWN_HARNESS_WORKER = join(BENCH_DIR, 'worker.ts')

/** Libraries in display order. `noop` is the control, not a competitor. */
const LIBRARIES = ['noop', 'mjst', 'typia', 'ajv', 'typebox', 'zod'] as const
type Library = (typeof LIBRARIES)[number]

const LABELS: Record<Library, string> = {
  noop: 'no-op (harness floor)',
  mjst: 'mjst (generated)',
  typia: 'typia (transformed)',
  ajv: 'ajv (compiled)',
  typebox: 'typebox (compiled)',
  zod: 'zod',
}

/**
 * How close to the no-op floor a result may get before it stops being a
 * measurement of the validator. A checker running at 80% of the speed of a
 * function that checks nothing is overwhelmingly harness cost, whatever the
 * table says.
 */
const NEAR_FLOOR = 0.8

/** benny's headline throughput for one measurement, with its own error bar. */
type Measurement = { ops: number; margin: number; samples: number }

type Runtime = { id: 'bun' | 'node'; command: string; version: string }

const pad = (s: string, width: number): string => s.padEnd(width)
const padStart = (s: string, width: number): string => s.padStart(width)

/** `189.34M ±3%`, or `n/a` for a library a runtime cannot host. */
const cell = (measurement: Measurement | null): string =>
  measurement === null ? 'n/a' : `${fmtOps(measurement.ops)} ±${measurement.margin.toFixed(0)}%`

/**
 * Generates the mjst validator for one case and transpiles it to JavaScript in a
 * temp dir. The Node worker cannot import TypeScript, and the whole point of the
 * exercise is to run the *same* module under both runtimes, so the generated
 * source is compiled once here rather than left to each runtime's loader.
 */
const buildMjstModule = async (caseName: string): Promise<string> => {
  const typeName = isStrictCase(caseName) ? 'AssertStrict' : 'AssertLoose'
  const files = await buildValidatorSchema(assertSchema(isStrictCase(caseName)), typeName)
  const dir = mkdtempSync(join(tmpdir(), 'mjst-moltar-'))
  const transpiler = new Bun.Transpiler({ loader: 'ts' })
  // The emitted imports already carry `.js` specifiers, so writing each file
  // under its `.js` name is all the rewriting needed; the manifest is what makes
  // Node read them as ES modules.
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}')
  for (const file of files) {
    writeFileSync(join(dir, file.filename.replace(/\.ts$/, '.js')), transpiler.transformSync(file.content))
  }
  return join(dir, 'index.js')
}

/** Runs one (runtime, case, library, mode) measurement in its own process. */
const runWorker = (
  runtime: Runtime,
  caseName: string,
  lib: Library,
  mode: 'discarded' | 'observed',
  mjstModule: string,
): Measurement | null => {
  // typia's checks are produced by a compile-time transform, which only the Bun
  // worker can host (via the same preload `run.ts` uses).
  if (lib === 'typia' && runtime.id !== 'bun') return null
  const flags = lib === 'typia' ? ['--preload', join(BENCH_DIR, 'typia-preload.ts')] : []
  try {
    const stdout = execFileSync(runtime.command, [...flags, WORKER, caseName, lib, mode, mjstModule], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
    return JSON.parse(stdout) as Measurement
  } catch (error) {
    const detail = error instanceof Error ? ((error as { stderr?: string }).stderr ?? error.message) : String(error)
    console.error(`  ⚠ ${runtime.id} · ${caseName} · ${lib} · ${mode} failed\n${detail.trim()}`)
    return null
  }
}

/** This package's own harness on the equivalent case, for the side-by-side. */
const ownHarnessOps = (caseName: string): number | null => {
  const equivalent = isStrictCase(caseName) ? 'assert-strict' : 'assert-loose'
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--conditions', 'development', OWN_HARNESS_WORKER, equivalent, 'mjst'],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
    )
    return (JSON.parse(stdout) as { valid: { median: number } }).valid.median
  } catch {
    return null
  }
}

/** Bun always (this is a Bun script); Node too when it is on PATH. */
const detectRuntimes = (): Runtime[] => {
  const runtimes: Runtime[] = [{ id: 'bun', command: process.execPath, version: `bun ${Bun.version}` }]
  try {
    const version = execFileSync('node', ['--version'], { encoding: 'utf8' }).trim()
    runtimes.push({ id: 'node', command: 'node', version: `node ${version}` })
  } catch {
    console.error('node not on PATH — measuring Bun only')
  }
  return runtimes
}

const run = async (): Promise<void> => {
  const runtimes = detectRuntimes()
  console.log('\n=== leaderboard conditions: the same validators under benny ===\n')
  console.log(`runtimes: ${runtimes.map((r) => r.version).join('  ·  ')}`)
  console.log('Every column is benny at its defaults, driving moltar’s Benchmark class over moltar’s')
  console.log('frozen fixture. "discarded" is upstream’s own `run()` (verdict thrown away); "observed"')
  console.log('folds the verdict into a counter. ± is benny’s relative margin of error.\n')

  const columns = runtimes.flatMap((runtime) =>
    (['discarded', 'observed'] as const).map((mode) => ({ runtime, mode, label: `${runtime.id} ${mode}` })),
  )

  for (const caseName of MOLTAR_CASES) {
    console.log(`## ${caseName}\n`)
    const mjstModule = await buildMjstModule(caseName)

    const results = new Map<string, Measurement | null>()
    for (const lib of LIBRARIES) {
      for (const column of columns) {
        results.set(`${lib}:${column.label}`, runWorker(column.runtime, caseName, lib, column.mode, mjstModule))
      }
    }

    console.log(`  ${pad('library', 22)}${columns.map((c) => padStart(c.label, 18)).join('')}`)
    for (const lib of LIBRARIES) {
      const cells = columns.map((c) => padStart(cell(results.get(`${lib}:${c.label}`) ?? null), 18)).join('')
      console.log(`  ${pad(LABELS[lib], 22)}${cells}`)
    }

    // The honesty check: a library at or above the floor is not being measured,
    // the harness is. Worth saying out loud rather than leaving to the reader.
    for (const column of columns) {
      const floor = results.get(`noop:${column.label}`)
      if (!floor) continue
      const bound = LIBRARIES.filter((lib) => lib !== 'noop').filter(
        (lib) => (results.get(`${lib}:${column.label}`)?.ops ?? 0) >= floor.ops * NEAR_FLOOR,
      )
      if (bound.length > 0) {
        console.log(`\n  ⚠ ${column.label}: ${bound.join(', ')} came within 20% of the no-op floor —`)
        console.log('    that cell is reporting harness overhead, not validation throughput.')
      }
    }

    const own = ownHarnessOps(caseName)
    if (own !== null) {
      console.log(`\n  reference — the same mjst function under this package's own harness`)
      console.log(`  (measure.ts: isolated process, median of 21 trials, pool of 32 mutable inputs):`)
      console.log(`    ${fmtOps(own)} ops/s\n`)
    }
  }

  console.log('Note: moltar’s fixture is `Object.freeze({ ... })`, so its assert cases run against a')
  console.log('non-extensible object. The own-harness reference above uses a mutable pool; the')
  console.log('like-for-like frozen figure is the `assert-strict (frozen)` case in `bun run bench`.\n')
}

await run()
