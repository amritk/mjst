import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Benchmarks this checkout's mjst against another checkout (normally `main`)
 * and emits a markdown delta table, for the PR-description bench report in CI
 * (`.github/workflows/bench.yml`) and for manual before/after checks.
 *
 *   bun run scripts/bench-compare.ts --baseline <dir> [--head <dir>] [--output <file>]
 *
 * Only mjst is timed — the zod/typebox/ajv/typia columns of the full benches
 * can't change from a PR, so they'd only add minutes and noise. Each
 * measurement reuses the benches' own isolation machinery: a fresh process per
 * (tree, case) via that tree's `bench/worker.ts`, median of 21 trials, CV as
 * the stability signal. Each side runs twice per case in order-balanced ABBA
 * sequence (base, head, head, base) and the better run is reported — warmup
 * and thermal drift then cannot systematically favor either side, and a
 * one-off interference spike costs a rerun instead of a false regression.
 *
 * Compared surfaces:
 *   - generate-parsers  — parse throughput (ops/s) per PARSE_CASE
 *   - generate-validators — validate throughput (ops/s, valid + invalid input)
 *   - codegen — buildSchema time per parser (ms), timed in-process per tree
 *
 * A case present only in the head tree reports `n/a (new case)` for main
 * instead of failing, so adding benchmarks never breaks the comparison.
 */

type Stats = { median: number; spread: number }

type WorkerOutput = { parityOk?: boolean } & Record<string, Stats | boolean | string | undefined>

/**
 * A worker run is a result, `null` for a case the tree genuinely does not have
 * (rendered "n/a (new case)"), or `'failed'` for a crashed/incompatible worker
 * — kept distinct so harness breakage is loud (⚠ + nonzero exit) instead of
 * masquerading as a benign new case.
 */
type WorkerRun = WorkerOutput | null | 'failed'

/** Set when any worker run failed; the process exits nonzero so CI goes red. */
let sawWorkerFailure = false

type Row = {
  readonly suite: string
  readonly caseName: string
  readonly metric: string
  /** true → ops/s (bigger is better); false → ms (smaller is better) */
  readonly higherIsBetter: boolean
  readonly base: Stats | null | 'failed'
  readonly head: Stats | null | 'failed'
  /** false when either tree's worker reported a parity failure for this case. */
  readonly parityOk?: boolean
}

const args = process.argv.slice(2)
const argValue = (flag: string): string | undefined => {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : undefined
}

const baselineDir = argValue('--baseline')
if (!baselineDir) {
  console.error(
    'usage: bun run scripts/bench-compare.ts --baseline <dir> [--head <dir>] [--output <file>] [--baseline-label <name>]',
  )
  process.exit(1)
}
const base = resolve(baselineDir)
const head = resolve(argValue('--head') ?? join(import.meta.dirname, '..'))
const outputPath = argValue('--output')
const baselineLabel = argValue('--baseline-label') ?? 'main'

const gitSha = (tree: string): string => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: tree, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

/**
 * Spawns one isolated mjst measurement using the given tree's own bench
 * worker, exactly as that tree's `bench/run.ts` would. Returns null when the
 * worker fails — most commonly a case name that doesn't exist in that tree.
 */
const runWorker = (tree: string, pkg: string, caseName: string): WorkerRun => {
  const benchDir = join(tree, 'packages', pkg, 'bench')
  const worker = join(benchDir, 'worker.ts')
  if (!existsSync(worker)) return null
  try {
    const stdout = execFileSync(process.execPath, ['--conditions', 'development', worker, caseName, 'mjst'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      cwd: benchDir,
    })
    return JSON.parse(stdout) as WorkerOutput
  } catch (error) {
    // A tree that predates the case throws "unknown parse case" / "unknown
    // bench case" — that is the benign "new case" outcome. Anything else is
    // harness breakage and must be loud, not an "n/a" cell.
    const detail = error instanceof Error ? `${error.message}\n${(error as { stderr?: string }).stderr ?? ''}` : ''
    if (detail.includes('unknown parse case') || detail.includes('unknown bench case')) return null
    sawWorkerFailure = true
    console.error(`worker failed: ${pkg} · ${caseName} · ${tree}\n${detail.trim()}`)
    return 'failed'
  }
}

/** The better of two throughput runs: higher `valid` median wins; a real run beats null/'failed'. */
const betterOps = (a: WorkerRun, b: WorkerRun): WorkerRun => {
  if (a === null || a === 'failed') return b === null || b === 'failed' ? a : b
  if (b === null || b === 'failed') return a
  const aMedian = (a['valid'] as Stats | undefined)?.median ?? 0
  const bMedian = (b['valid'] as Stats | undefined)?.median ?? 0
  return aMedian >= bMedian ? a : b
}

/** The better of two codegen runs: lower ms median wins; a real run beats 'failed'. */
const betterMs = (a: Stats | 'failed', b: Stats | 'failed'): Stats | 'failed' => {
  if (a === 'failed') return b
  if (b === 'failed') return a
  return a.median <= b.median ? a : b
}

/** One order-balanced ABBA measurement of a case on both trees. */
const runPair = (pkg: string, caseName: string): { base: WorkerRun; head: WorkerRun } => {
  const base1 = runWorker(base, pkg, caseName)
  const head1 = runWorker(head, pkg, caseName)
  const head2 = runWorker(head, pkg, caseName)
  const base2 = runWorker(base, pkg, caseName)
  return { base: betterOps(base1, base2), head: betterOps(head1, head2) }
}

/**
 * Times a tree's `buildSchema` (parser codegen) for one case in a fresh
 * process (`bench-codegen-worker.ts`, always taken from the head tree but
 * pointed at either checkout), so the two trees never share JIT state and an
 * unbuilt baseline resolves its workspace deps to sources via
 * `--conditions development`.
 */
const codegenStats = (tree: string, schema: unknown, mode: string): Stats | 'failed' => {
  const worker = join(head, 'scripts', 'bench-codegen-worker.ts')
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--conditions', 'development', worker, tree, mode, JSON.stringify(schema)],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    )
    return JSON.parse(stdout) as Stats
  } catch (error) {
    sawWorkerFailure = true
    const detail = error instanceof Error ? `${error.message}\n${(error as { stderr?: string }).stderr ?? ''}` : ''
    console.error(`codegen worker failed: ${mode} · ${tree}\n${detail.trim()}`)
    return 'failed'
  }
}

const fmtOps = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(1)
}

const cell = (stats: Stats | null | 'failed', higherIsBetter: boolean): string => {
  if (stats === 'failed') return '⚠ worker failed'
  if (!stats) return 'n/a (new case)'
  const value = higherIsBetter ? fmtOps(stats.median) : `${stats.median.toFixed(2)}ms`
  return `${value} ±${(stats.spread * 100).toFixed(0)}%`
}

/** Within this fraction the delta is called noise (⚪); beyond it, 🟢/🔴. */
const SIGNIFICANT = 0.05
/** A CV above this marks the measurement itself as unstable (~). */
const NOISY_SPREAD = 0.1

const delta = (row: Row): string => {
  const parity = row.parityOk === false ? ' ⚠parity' : ''
  if (row.base === 'failed' || row.head === 'failed') return `—${parity}`
  if (!row.base || !row.head || row.base.median <= 0) return `—${parity}`
  const pct = (row.head.median - row.base.median) / row.base.median
  const improved = row.higherIsBetter ? pct > 0 : pct < 0
  const noisy = row.base.spread > NOISY_SPREAD || row.head.spread > NOISY_SPREAD
  const verdict = Math.abs(pct) < SIGNIFICANT ? '⚪' : improved ? '🟢' : '🔴'
  return `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(1)}% ${verdict}${noisy ? '~' : ''}${parity}`
}

/** Extracts one metric from a worker run, propagating the failure sentinel. */
const statOf = (workerRun: WorkerRun, metric: string): Stats | null | 'failed' => {
  if (workerRun === 'failed') return 'failed'
  return (workerRun?.[metric] as Stats | undefined) ?? null
}

/** Parity is only meaningful for real runs; null/'failed' don't vote. */
const pairParityOk = (baseRun: WorkerRun, headRun: WorkerRun): boolean => {
  const bad = (r: WorkerRun): boolean => r !== null && r !== 'failed' && r.parityOk === false
  return !bad(baseRun) && !bad(headRun)
}

const run = async (): Promise<void> => {
  const rows: Row[] = []
  const progress = (row: Row): void => {
    rows.push(row)
    console.error(
      `  ${row.suite} · ${row.caseName} · ${row.metric}: main ${cell(row.base, row.higherIsBetter)} → PR ${cell(row.head, row.higherIsBetter)}  ${delta(row)}`,
    )
  }

  // Case lists always come from the head tree; a baseline missing a case
  // reports n/a rather than failing.
  const parsersSchemas = (await import(
    pathToFileURL(join(head, 'packages/generate-parsers/bench/schemas.ts')).href
  )) as { PARSE_CASES: readonly { name: string; mode: string; schema: unknown }[] }

  console.error('generate-parsers (parse ops/s)…')
  for (const parseCase of parsersSchemas.PARSE_CASES) {
    const { base: baseResult, head: headResult } = runPair('generate-parsers', parseCase.name)
    progress({
      suite: 'parsers',
      caseName: parseCase.name,
      metric: 'parse ops/s',
      higherIsBetter: true,
      base: statOf(baseResult, 'valid'),
      head: statOf(headResult, 'valid'),
      parityOk: pairParityOk(baseResult, headResult),
    })
  }

  const validatorsSchemas = (await import(
    pathToFileURL(join(head, 'packages/generate-validators/bench/schemas.ts')).href
  )) as { BENCH_CASES: readonly { name: string }[] }

  console.error('generate-validators (validate ops/s)…')
  for (const benchCase of validatorsSchemas.BENCH_CASES) {
    const { base: baseResult, head: headResult } = runPair('generate-validators', benchCase.name)
    for (const metric of ['valid', 'invalid'] as const) {
      progress({
        suite: 'validators',
        caseName: benchCase.name,
        metric: `${metric} ops/s`,
        higherIsBetter: true,
        base: statOf(baseResult, metric),
        head: statOf(headResult, metric),
        parityOk: pairParityOk(baseResult, headResult),
      })
    }
  }

  console.error('parser codegen (ms per buildSchema)…')
  for (const parseCase of parsersSchemas.PARSE_CASES) {
    const base1 = codegenStats(base, parseCase.schema, parseCase.mode)
    const head1 = codegenStats(head, parseCase.schema, parseCase.mode)
    const head2 = codegenStats(head, parseCase.schema, parseCase.mode)
    const base2 = codegenStats(base, parseCase.schema, parseCase.mode)
    progress({
      suite: 'codegen',
      caseName: parseCase.name,
      metric: 'ms/parser',
      higherIsBetter: false,
      base: betterMs(base1, base2),
      head: betterMs(head1, head2),
    })
  }

  const lines: string[] = []
  lines.push('<!-- mjst-bench-delta:start -->')
  lines.push(`### ⚡ Benchmark delta vs ${baselineLabel} (\`${gitSha(base)}\` → \`${gitSha(head)}\`)`)
  lines.push('')
  lines.push('| Suite | Case | Metric | main | PR | Δ |')
  lines.push('|---|---|---|---:|---:|---:|')
  for (const row of rows) {
    lines.push(
      `| ${row.suite} | ${row.caseName} | ${row.metric} | ${cell(row.base, row.higherIsBetter)} | ${cell(row.head, row.higherIsBetter)} | ${delta(row)} |`,
    )
  }
  lines.push('')
  lines.push(
    '<sub>mjst only; each number is the better of two order-balanced (ABBA) runs, each the median of 21 isolated-process trials (±n% = coefficient of variation). ' +
      '⚪ within ±5% · 🟢 improvement · 🔴 regression · ~ marks an unstable sample (CV > 10%) · ⚠parity marks a correctness disagreement. ' +
      'On shared CI runners, deltas within ±10% are usually noise — trust direction only when it persists across pushes.</sub>',
  )
  lines.push('<!-- mjst-bench-delta:end -->')

  const markdown = lines.join('\n')
  if (outputPath) writeFileSync(outputPath, `${markdown}\n`, 'utf-8')
  console.log(markdown)

  if (sawWorkerFailure) {
    console.error('one or more bench workers failed — the delta table above is incomplete')
    process.exitCode = 1
  }
}

await run()
