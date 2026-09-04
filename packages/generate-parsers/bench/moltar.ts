import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildSchema } from '../src/index.ts'
import { fmtOps } from './measure.ts'
import { isStrictCase, MOLTAR_MODES, MOLTAR_PARSE_CASES, parseSchema } from './moltar-data.mjs'

/**
 * The same parsers as `run.ts`, measured under
 * `moltar/typescript-runtime-type-benchmarks`' harness instead of this repo's.
 *
 * Why this exists: the two harnesses disagree by roughly an order of magnitude
 * on the same function, and a README that quotes one while naming the other is
 * not comparing like with like. `run.ts` times a parser directly over a pool of
 * distinct inputs and reports the median of 21 trials. The leaderboard runs
 * benny (benchmark.js) over moltar's `Benchmark` class — every operation is a
 * call into a compiled benchmark loop, then a call through a class property,
 * around a fixture that is a single frozen module-level constant whose *result
 * is thrown away*. For a parser that last part is decisive: the result is a
 * fresh object, and an engine that can inline the parser can also prove the
 * object never escapes and skip allocating it. Whether it can inline the parser
 * is a function of how big the parser is — which is why this table is the one
 * that moves when the emitter splits its cold path out.
 *
 * So this table always carries the controls that make the ceiling visible:
 *
 *   - a **no-op** row — a "parser" that returns its input unchanged. Nothing
 *     measured under this harness can honestly exceed it, and anything close to
 *     it is reporting benny's per-operation cost rather than parse cost.
 *   - **discarded vs observed** — upstream's `run()` throws the value away,
 *     which lets V8 delete the allocation outright; reading one field of the
 *     result in the same shape shows how much of the "throughput" was
 *     elimination.
 *
 * Every library's four measurements (both cases × both modes) run in **one
 * process**, so the four numbers are directly comparable with each other;
 * libraries still get a process each, which is the isolation upstream relies on.
 * Both runtimes are measured when both are installed: the public leaderboard
 * publishes Node numbers, this repo benches on Bun, and that difference is worth
 * a column rather than a hand-wave.
 *
 *   bun run bench:moltar
 */

const BENCH_DIR = fileURLToPath(new URL('.', import.meta.url))
const WORKER = join(BENCH_DIR, 'moltar-worker.mjs')

/** Libraries in display order. `noop` is the control, not a competitor. */
const LIBRARIES = ['noop', 'mjst', 'typebox', 'zod'] as const
type Library = (typeof LIBRARIES)[number]

const LABELS: Record<Library, string> = {
  noop: 'no-op (harness floor)',
  mjst: 'mjst (generated)',
  typebox: 'typebox (compiled)',
  zod: 'zod (.parse)',
}

/**
 * How close to the no-op floor a result may get before it stops being a
 * measurement of the parser. A parser running at 80% of the speed of a function
 * that returns its argument is overwhelmingly harness cost, whatever the table
 * says.
 */
const NEAR_FLOOR = 0.8

/** benny's headline throughput for one measurement, with its own error bar. */
type Measurement = { ops: number; margin: number; samples: number }
type WorkerResults = Record<string, Measurement>
type Runtime = { id: 'bun' | 'node'; command: string; version: string }

const pad = (s: string, width: number): string => s.padEnd(width)
const padStart = (s: string, width: number): string => s.padStart(width)

/** `58.51M ±3%`, or `n/a` for a measurement that did not complete. */
const cell = (measurement: Measurement | undefined): string =>
  measurement === undefined ? 'n/a' : `${fmtOps(measurement.ops)} ±${measurement.margin.toFixed(0)}%`

/**
 * Generates the mjst parser for one case and transpiles it to JavaScript in a
 * temp dir. The Node worker cannot import TypeScript, and the whole point of the
 * exercise is to run the *same* module under both runtimes, so the generated
 * source is compiled once here rather than left to each runtime's loader.
 */
const buildMjstModule = async (caseName: string): Promise<string> => {
  const closed = isStrictCase(caseName)
  const files = await buildSchema(
    parseSchema(closed) as Parameters<typeof buildSchema>[0],
    'Assert',
    undefined, // extensions
    false, // typesOnly
    false, // logWarnings
    true, // strict
    'embedded', // helpersMode — ship helper sources so the temp dir is self-contained
    './', // helpersImportPrefix
    false, // readonly
    !closed, // stripUnknown — strip extras (safe) vs reject them via the closed schema (strict)
  )
  const dir = mkdtempSync(join(tmpdir(), 'mjst-moltar-parse-'))
  const transpiler = new Bun.Transpiler({ loader: 'ts' })
  // The emitted imports already carry `.js` specifiers, so writing each file
  // under its `.js` name is all the rewriting needed; the manifest is what makes
  // Node read them as ES modules.
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}')
  for (const file of files) {
    // `helpersMode: 'embedded'` emits the helpers under `_helpers/`, so the
    // directory has to exist before the first one is written.
    const path = join(dir, file.filename.replace(/\.ts$/, '.js'))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, transpiler.transformSync(file.content))
  }
  return join(dir, 'index.js')
}

/** Runs one library's four measurements in its own process. */
const runWorker = (runtime: Runtime, lib: Library, modules: Record<string, string>): WorkerResults => {
  try {
    const stdout = execFileSync(
      runtime.command,
      [WORKER, lib, modules.parseSafe as string, modules.parseStrict as string],
      { encoding: 'utf8', maxBuffer: 1024 * 1024, cwd: BENCH_DIR },
    )
    return JSON.parse(stdout) as WorkerResults
  } catch (error) {
    const detail = error instanceof Error ? ((error as { stderr?: string }).stderr ?? error.message) : String(error)
    console.error(`  ⚠ ${runtime.id} · ${lib} failed\n${detail.trim()}`)
    return {}
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
  console.log('\n=== leaderboard conditions: the same parsers under benny ===\n')
  console.log(`runtimes: ${runtimes.map((r) => r.version).join('  ·  ')}`)
  console.log('Every column is benny at its defaults, driving moltar’s Benchmark class over moltar’s')
  console.log('frozen fixture. "discarded" is upstream’s own `run()` (parsed value thrown away);')
  console.log('"observed" reads one field of it. ± is benny’s relative margin of error.')
  console.log('All four (case × mode) measurements for a library run in one process.\n')

  const modules: Record<string, string> = {}
  for (const caseName of MOLTAR_PARSE_CASES) modules[caseName] = await buildMjstModule(caseName)

  const results = new Map<string, WorkerResults>()
  for (const runtime of runtimes) {
    for (const lib of LIBRARIES) results.set(`${lib}:${runtime.id}`, runWorker(runtime, lib, modules))
  }

  const columns = runtimes.flatMap((runtime) =>
    MOLTAR_MODES.map((mode: string) => ({ runtime, mode, label: `${runtime.id} ${mode}` })),
  )

  for (const caseName of MOLTAR_PARSE_CASES) {
    console.log(`## ${caseName}\n`)
    console.log(`  ${pad('library', 22)}${columns.map((c) => padStart(c.label, 18)).join('')}`)
    for (const lib of LIBRARIES) {
      const cells = columns
        .map((c) => padStart(cell(results.get(`${lib}:${c.runtime.id}`)?.[`${caseName}:${c.mode}`]), 18))
        .join('')
      console.log(`  ${pad(LABELS[lib], 22)}${cells}`)
    }

    // The honesty check: a library at or above the floor is not being measured,
    // the harness is. Worth saying out loud rather than leaving to the reader.
    for (const column of columns) {
      const floor = results.get(`noop:${column.runtime.id}`)?.[`${caseName}:${column.mode}`]
      if (floor === undefined) continue
      const bound = LIBRARIES.filter((lib) => lib !== 'noop').filter(
        (lib) =>
          (results.get(`${lib}:${column.runtime.id}`)?.[`${caseName}:${column.mode}`]?.ops ?? 0) >=
          floor.ops * NEAR_FLOOR,
      )
      if (bound.length > 0) {
        console.log(`\n  ⚠ ${column.label}: ${bound.join(', ')} came within 20% of the no-op floor —`)
        console.log('    that cell is reporting harness overhead, not parse throughput.')
      }
    }
    console.log('')
  }
}

await run()
