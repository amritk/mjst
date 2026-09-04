import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

// Bench code is unpublished dev tooling, so it reaches across the workspace by
// relative path (the same deliberate shortcut `measure.ts` takes) — the parse
// modes need the parser generator, which lives in the sibling package.
import { buildSchema } from '../../generate-parsers/src/index.ts'
import { buildValidatorSchema } from '../src/index.ts'
import { fmtOps } from './measure.ts'
import { assertSchema, MODE_DESCRIPTIONS, MOLTAR_MODES } from './moltar-data.mjs'

/**
 * The same generated code as `run.ts`, measured under
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
 * The *process layout* is reproduced too, because it turned out to matter more
 * than the harness. Upstream runs one process per library and registers all four
 * of its modes in it — parseSafe, parseStrict, assertLoose, assertStrict, in
 * that order — against one CommonJS module whose exports it reads off the module
 * object on every call. So this file:
 *
 *   1. generates all four mjst functions, wires them into a single entry module,
 *      and compiles that entry **twice**: once to plain data-property exports
 *      (tsc, `--module commonjs` — what a consumer compiling the output gets),
 *      and once to accessor exports (esbuild `--bundle --format=cjs`, whose
 *      `__export` helper defines every export as a getter);
 *   2. runs each library's modes in one worker process, in upstream's order;
 *   3. runs every mode a *second* time alone in its own process.
 *
 * (2) versus (3) is the control that makes the export shape visible. A getter on
 * `module.exports` is free while one export is all a process ever touches, and
 * expensive once a second one has been hot in the same process — which is
 * exactly the difference between running a mode alone and running it fourth.
 * Read the `assertLoose` table: the two mjst entries agree when each is alone
 * and diverge when the parse modes ran first.
 *
 * So this table always carries the controls that make the measurement legible:
 *
 *   - a **no-op** row — a validator that checks nothing. Nothing measured under
 *     this harness can honestly exceed it, and anything close to it is reporting
 *     benny's per-operation cost rather than validation cost.
 *   - **discarded vs observed** — upstream's `run()` throws the verdict away,
 *     which lets V8 delete the call outright; observing it in the same shape
 *     shows how much of the "throughput" was elimination.
 *   - **alone vs in the four-mode sequence**, and **data-property vs getter
 *     exports**, as described above.
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

// Bun's ESM interop hands back a stub for the `typescript` package, so the
// compiler API comes in through a CommonJS require.
const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript')

/** Libraries in display order. `noop` is the control, not a competitor. */
const LIBRARIES = ['noop', 'mjst', 'typia', 'ajv', 'typebox', 'zod'] as const
type Library = (typeof LIBRARIES)[number]

type Mode = (typeof MOLTAR_MODES)[number]

/**
 * How the mjst entry module exposes its four functions once compiled to
 * CommonJS. Both are built from the *same* generated sources — only the
 * compiler differs, so any gap between them is the export shape and nothing
 * else.
 *
 *   - `data` — `exports.assertLoose = …`, which is what tsc emits for the
 *     `export const` the generators write, and what a consumer compiling the
 *     output with tsc gets.
 *   - `getter` — `Object.defineProperty(exports, 'assertLoose', { get … })`,
 *     which is what esbuild's `__export` helper emits when it bundles to CJS
 *     (and what TypeScript itself emits for an `export { x } from './y'`
 *     re-export, which is why the generated barrels never use that form).
 */
type EntryShape = 'data' | 'getter'

const ENTRY_LABELS: Record<EntryShape, string> = {
  data: 'tsc --module commonjs',
  getter: 'esbuild --bundle --format=cjs',
}

/** One row of every table: a library, plus how its module was built and run. */
type Row = {
  readonly key: string
  readonly label: string
  readonly lib: Library
  readonly entry?: EntryShape
  /** Runs this row's mode alone in a fresh process instead of after the others. */
  readonly alone?: boolean
}

const ROWS: readonly Row[] = [
  { key: 'noop', label: 'no-op (harness floor)', lib: 'noop' },
  { key: 'mjst', label: 'mjst (generated)', lib: 'mjst', entry: 'data' },
  { key: 'mjst-alone', label: '  ↳ alone in its process', lib: 'mjst', entry: 'data', alone: true },
  { key: 'mjst-getter', label: 'mjst, getter exports', lib: 'mjst', entry: 'getter' },
  { key: 'mjst-getter-alone', label: '  ↳ alone in its process', lib: 'mjst', entry: 'getter', alone: true },
  { key: 'typia', label: 'typia (transformed)', lib: 'typia' },
  { key: 'ajv', label: 'ajv (compiled)', lib: 'ajv' },
  { key: 'typebox', label: 'typebox (compiled)', lib: 'typebox' },
  { key: 'zod', label: 'zod', lib: 'zod' },
]

/**
 * How close to the no-op floor a result may get before it stops being a
 * measurement of the validator. A checker running at 80% of the speed of a
 * function that checks nothing is overwhelmingly harness cost, whatever the
 * table says.
 */
const NEAR_FLOOR = 0.8

/**
 * How far a mode may drop between running alone and running fourth before the
 * gap is worth calling out. Some drop is expected in any warm process — the
 * heap has been churned and the JIT has other code to care about — so this is
 * set well above the noise.
 */
const SEQUENCE_DROP = 0.25

/** benny's headline throughput for one measurement, with its own error bar. */
type Measurement = { ops: number; margin: number; samples: number }

type Runtime = { id: 'bun' | 'node'; command: string; version: string }

const pad = (s: string, width: number): string => s.padEnd(width)
const padStart = (s: string, width: number): string => s.padStart(width)

/** `189.34M ±3%`, or `n/a` for a library a runtime cannot host. */
const cell = (measurement: Measurement | null): string =>
  measurement === null ? 'n/a' : `${fmtOps(measurement.ops)} ±${measurement.margin.toFixed(0)}%`

/** `-43%` — how far `after` fell short of `before`. */
const dropPct = (before: number, after: number): string => `${(((after - before) / before) * 100).toFixed(0)}%`

/** Every file under `root`, as paths relative to it. */
const filesUnder = (root: string, rel = ''): string[] =>
  readdirSync(join(root, rel)).flatMap((name) => {
    const child = join(rel, name)
    return statSync(join(root, child)).isDirectory() ? filesUnder(root, child) : [child]
  })

/**
 * Generates all four mjst functions for the moltar contract and wires them into
 * one entry module, then compiles that entry to CommonJS twice — see
 * {@link EntryShape}.
 *
 * Each mode gets its own subdirectory because every build names its files after
 * its root type and emits its own `index.ts` barrel; the entry then imports the
 * four barrels and re-exports them under upstream's names. That entry is written
 * the way the benchmark repo writes its case file — `import { … }` followed by
 * `export const x = …`, never `export { x } from …`, which would put a getter on
 * the entry's own exports whatever compiles it.
 *
 * @returns The compiled entry path for each shape.
 */
const buildMjstEntry = async (): Promise<Record<EntryShape, string>> => {
  const dir = mkdtempSync(join(tmpdir(), 'mjst-moltar-'))
  const srcDir = join(dir, 'src')

  const write = (rel: string, content: string): void => {
    const path = join(srcDir, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }

  // `strict` throws on a type mismatch in every mode, so all four carry
  // upstream's contract; `stripUnknown` is what separates parseSafe (drop
  // undeclared keys) from parseStrict (reject them, via the closed schema).
  const parserArgs = [undefined, false, false, true, 'embedded', './', false] as const
  const builds = [
    ['parse-safe', await buildSchema(assertSchema(false), 'ParseSafe', ...parserArgs, true)],
    ['parse-strict', await buildSchema(assertSchema(true), 'ParseStrict', ...parserArgs, false)],
    ['assert-loose', await buildValidatorSchema(assertSchema(false), 'AssertLoose')],
    ['assert-strict', await buildValidatorSchema(assertSchema(true), 'AssertStrict')],
  ] as const

  for (const [subDir, files] of builds) {
    for (const file of files) write(join(subDir, file.filename), file.content)
  }

  write(
    'entry.ts',
    `import { parseParseSafe } from './parse-safe/index.js';
import { parseParseStrict } from './parse-strict/index.js';
import { validateAssertLoose } from './assert-loose/index.js';
import { validateAssertStrict } from './assert-strict/index.js';

export const parseSafe = parseParseSafe;
export const parseStrict = parseParseStrict;
export const assertLoose = validateAssertLoose;
export const assertStrict = validateAssertStrict;
`,
  )

  // Shape 1 — tsc to CommonJS, file by file. The generated imports already carry
  // `.js` specifiers, so writing each file under its `.js` name is all the
  // rewriting needed. `transpileModule` skips type checking, which the emit for
  // these modules does not depend on.
  const dataDir = join(dir, 'cjs')
  for (const rel of filesUnder(srcDir)) {
    const { outputText } = ts.transpileModule(readFileSync(join(srcDir, rel), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    })
    const path = join(dataDir, rel.replace(/\.ts$/, '.js'))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, outputText)
  }
  writeFileSync(join(dataDir, 'package.json'), '{"type":"commonjs"}')

  // Shape 2 — the same entry bundled to CJS, whose `__export` helper turns every
  // export into a getter.
  const getterDir = join(dir, 'cjs-bundled')
  mkdirSync(getterDir, { recursive: true })
  buildSync({
    entryPoints: [join(srcDir, 'entry.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: join(getterDir, 'entry.js'),
  })
  writeFileSync(join(getterDir, 'package.json'), '{"type":"commonjs"}')

  return { data: join(dataDir, 'entry.js'), getter: join(getterDir, 'entry.js') }
}

/**
 * Runs one worker process and returns its measurement per mode. `modes` is the
 * whole point of the call: pass all four and they share a process in upstream's
 * order, pass one and it runs alone.
 */
const runWorker = (
  runtime: Runtime,
  row: Row,
  benchMode: 'discarded' | 'observed',
  modes: readonly Mode[],
  entries: Record<EntryShape, string>,
): Record<string, Measurement | null> => {
  // typia's checks are produced by a compile-time transform, which only the Bun
  // worker can host (via the same preload `run.ts` uses).
  if (row.lib === 'typia' && runtime.id !== 'bun') return {}
  const flags = row.lib === 'typia' ? ['--preload', join(BENCH_DIR, 'typia-preload.ts')] : []
  const entry = row.entry ? entries[row.entry] : ''

  try {
    const stdout = execFileSync(runtime.command, [...flags, WORKER, row.lib, benchMode, modes.join(','), entry], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
    return JSON.parse(stdout) as Record<string, Measurement | null>
  } catch (error) {
    const detail = error instanceof Error ? ((error as { stderr?: string }).stderr ?? error.message) : String(error)
    console.error(`  ⚠ ${runtime.id} · ${row.key} · ${benchMode} · ${modes.join(',')} failed\n${detail.trim()}`)
    return {}
  }
}

/** This package's own harness on the equivalent case, for the side-by-side. */
const ownHarnessOps = (mode: Mode): number | null => {
  // Only the assert modes have a counterpart here; `run.ts` benches validators,
  // and the parse modes' counterpart lives in generate-parsers' own bench.
  const equivalent = mode === 'assertStrict' ? 'assert-strict' : mode === 'assertLoose' ? 'assert-loose' : null
  if (equivalent === null) return null
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
  const entries = await buildMjstEntry()

  console.log('\n=== leaderboard conditions: the same generated code under benny ===\n')
  console.log(`runtimes: ${runtimes.map((r) => r.version).join('  ·  ')}`)
  console.log('Every column is benny at its defaults, driving moltar’s Benchmark class over moltar’s')
  console.log('frozen fixture. "discarded" is upstream’s own `run()` (verdict thrown away); "observed"')
  console.log('folds the verdict into a counter. ± is benny’s relative margin of error.\n')
  console.log(`All four modes run in one process per library, in upstream’s order: ${MOLTAR_MODES.join(' → ')}.`)
  console.log('The "↳ alone" rows re-run one mode in a fresh process, so a number that depends on what')
  console.log('ran before it in the same process shows up as a gap between the two rows.\n')
  console.log(`mjst entry modules: data-property exports (${ENTRY_LABELS.data})`)
  console.log(`                    getter exports       (${ENTRY_LABELS.getter})\n`)

  const columns = runtimes.flatMap((runtime) =>
    (['discarded', 'observed'] as const).map((benchMode) => ({
      runtime,
      benchMode,
      label: `${runtime.id} ${benchMode}`,
    })),
  )

  // key: `${row.key}:${column.label}:${mode}`
  const results = new Map<string, Measurement | null>()
  const at = (row: Row, columnLabel: string, mode: Mode): Measurement | null =>
    results.get(`${row.key}:${columnLabel}:${mode}`) ?? null

  for (const column of columns) {
    for (const row of ROWS) {
      // A row measured alone gets one process per mode; the rest get one process
      // for all four, which is the layout being reproduced.
      const runs = row.alone ? MOLTAR_MODES.map((mode) => [mode]) : [MOLTAR_MODES]
      for (const modes of runs) {
        // Every table is printed at the end (the rows are cross-referenced), so
        // progress goes to stderr as it happens rather than leaving a
        // ten-minute run looking hung.
        console.error(`  · ${column.label} · ${row.key} · ${modes.join(',')}`)
        const measured = runWorker(column.runtime, row, column.benchMode, modes, entries)
        for (const mode of modes) {
          results.set(`${row.key}:${column.label}:${mode}`, measured[mode] ?? null)
        }
      }
    }
  }

  for (const mode of MOLTAR_MODES) {
    console.log(`## ${mode} — ${MODE_DESCRIPTIONS[mode]}\n`)

    console.log(`  ${pad('library', 26)}${columns.map((c) => padStart(c.label, 18)).join('')}`)
    for (const row of ROWS) {
      const cells = columns.map((c) => padStart(cell(at(row, c.label, mode)), 18)).join('')
      console.log(`  ${pad(row.label, 26)}${cells}`)
    }

    // The honesty check: a library at or above the floor is not being measured,
    // the harness is. Worth saying out loud rather than leaving to the reader.
    for (const column of columns) {
      const floor = at(ROWS[0] as Row, column.label, mode)
      if (!floor) continue
      const bound = ROWS.slice(1)
        .filter((row) => (at(row, column.label, mode)?.ops ?? 0) >= floor.ops * NEAR_FLOOR)
        .map((row) => row.key)
      if (bound.length > 0) {
        console.log(`\n  ⚠ ${column.label}: ${bound.join(', ')} came within 20% of the no-op floor —`)
        console.log('    that cell is reporting harness overhead, not validation throughput.')
      }
    }

    // Does this number depend on what ran before it? Only the mjst rows have an
    // "alone" counterpart, because only they are called through a module object.
    for (const [sequenced, alone] of [
      ['mjst', 'mjst-alone'],
      ['mjst-getter', 'mjst-getter-alone'],
    ]) {
      const sequencedRow = ROWS.find((row) => row.key === sequenced) as Row
      const aloneRow = ROWS.find((row) => row.key === alone) as Row
      for (const column of columns) {
        const inSequence = at(sequencedRow, column.label, mode)
        const isolated = at(aloneRow, column.label, mode)
        if (!inSequence || !isolated) continue
        if (inSequence.ops >= isolated.ops * (1 - SEQUENCE_DROP)) continue
        console.log(
          `\n  ⚠ ${column.label}: ${sequencedRow.label.trim()} ran at ${fmtOps(inSequence.ops)} in the four-mode`,
        )
        console.log(
          `    sequence but ${fmtOps(isolated.ops)} alone (${dropPct(isolated.ops, inSequence.ops)}) — this mode's`,
        )
        console.log('    number depends on what ran before it in the same process.')
      }
    }

    const own = ownHarnessOps(mode)
    if (own !== null) {
      console.log(`\n  reference — the same mjst function under this package's own harness`)
      console.log(`  (measure.ts: isolated process, median of 21 trials, pool of 32 mutable inputs):`)
      console.log(`    ${fmtOps(own)} ops/s`)
    }
    console.log('')
  }

  // The headline the process layout exists to expose, spelled out per column.
  console.log('### export shape — the same functions, the same sequence, two entry modules\n')
  console.log(
    `  ${pad('mode', 16)}${pad('column', 18)}${padStart('data-property', 16)}${padStart('getter', 16)}${padStart('difference', 14)}`,
  )
  for (const mode of MOLTAR_MODES) {
    for (const column of columns) {
      const data = at(ROWS.find((row) => row.key === 'mjst') as Row, column.label, mode)
      const getter = at(ROWS.find((row) => row.key === 'mjst-getter') as Row, column.label, mode)
      if (!data || !getter) continue
      const difference = padStart(dropPct(data.ops, getter.ops), 14)
      console.log(
        `  ${pad(mode, 16)}${pad(column.label, 18)}${padStart(fmtOps(data.ops), 16)}${padStart(fmtOps(getter.ops), 16)}${difference}`,
      )
    }
  }
  console.log('')
  console.log('Both entries are the same generated sources; only the compiler differs. The getter')
  console.log('column is what a bundler’s CJS output does to `module.exports`, and it is invisible')
  console.log('until a second export has been hot in the same process — compare each mode’s "↳ alone"')
  console.log('row above, where the two entries agree.\n')

  console.log('Note: moltar’s fixture is `Object.freeze({ ... })`, so its assert cases run against a')
  console.log('non-extensible object. The own-harness reference above uses a mutable pool; the')
  console.log('like-for-like frozen figure is the `assert-strict (frozen)` case in `bun run bench`.\n')
}

await run()
