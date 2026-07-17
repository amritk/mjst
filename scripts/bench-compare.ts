import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { fmtOps, NOISY_SPREAD } from '../packages/generate-parsers/bench/measure.ts'

/**
 * Benchmarks this checkout's mjst against another checkout (normally `main`)
 * and emits a markdown delta table, for the PR-description bench report in CI
 * (`.github/workflows/bench.yml`) and for manual before/after checks.
 *
 *   bun run scripts/bench-compare.ts --baseline <dir> [--head <dir>] [--output <file>] [--suites a,b]
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
 *   - api — request throughput (req/s) through the runtime and compiled
 *     engines, per API_BENCH_CASES
 *   - codegen — buildSchema time per parser (ms), timed in-process per tree
 *
 * A case present only in the head tree reports `n/a (new case)` for main
 * instead of failing, so adding benchmarks never breaks the comparison.
 */

type Stats = { median: number; spread: number }

/** The two metrics the bench workers emit; a field rename over there should fail loudly here. */
type WorkerOutput = { parityOk?: boolean; valid?: Stats; invalid?: Stats }

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

/** Suite filter for quick local runs: `--suites api` or `--suites parsers,codegen`. CI runs all. */
const ALL_SUITES = ['parsers', 'validators', 'api', 'codegen'] as const
const suitesArg = argValue('--suites')
const suites = new Set<string>(suitesArg === undefined ? ALL_SUITES : suitesArg.split(','))
for (const name of suites) {
  if (!(ALL_SUITES as readonly string[]).includes(name)) {
    console.error(`unknown suite '${name}' — valid: ${ALL_SUITES.join(', ')}`)
    process.exit(1)
  }
}

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
 *
 * `developConditions: false` drops `--conditions development`, so workspace
 * dependencies resolve to their built `dist` instead of TypeScript sources.
 * The api workers need this: `@amritk/runtime-validators` sources use `@/`
 * path aliases that Bun cannot resolve across package boundaries, and timing
 * the compiled artifact is what consumers experience anyway. The workflow
 * builds that package in both trees before benching.
 */
const runWorker = (tree: string, pkg: string, caseName: string, developConditions = true): WorkerRun => {
  const benchDir = join(tree, 'packages', pkg, 'bench')
  const worker = join(benchDir, 'worker.ts')
  if (!existsSync(worker)) return null
  try {
    const conditions = developConditions ? ['--conditions', 'development'] : []
    const stdout = execFileSync(process.execPath, [...conditions, worker, caseName, 'mjst'], {
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
  const aMedian = a.valid?.median ?? 0
  const bMedian = b.valid?.median ?? 0
  return aMedian >= bMedian ? a : b
}

/** The better of two codegen runs: lower ms median wins; a real run beats 'failed'. */
const betterMs = (a: Stats | 'failed', b: Stats | 'failed'): Stats | 'failed' => {
  if (a === 'failed') return b
  if (b === 'failed') return a
  return a.median <= b.median ? a : b
}

/**
 * One order-balanced ABBA measurement on both trees: base, head, head, base,
 * keeping each side's better run — the single measurement protocol for every
 * suite, so the whole table sits under the same bias regime.
 */
const abbaPair = <T>(runOn: (tree: string) => T, better: (a: T, b: T) => T): { base: T; head: T } => {
  const base1 = runOn(base)
  const head1 = runOn(head)
  const head2 = runOn(head)
  const base2 = runOn(base)
  return { base: better(base1, base2), head: better(head1, head2) }
}

const runPair = (pkg: string, caseName: string): { base: WorkerRun; head: WorkerRun } =>
  abbaPair((tree) => runWorker(tree, pkg, caseName), betterOps)

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

const cell = (stats: Stats | null | 'failed', higherIsBetter: boolean): string => {
  if (stats === 'failed') return '⚠ worker failed'
  if (!stats) return 'n/a (new case)'
  const value = higherIsBetter ? fmtOps(stats.median) : `${stats.median.toFixed(2)}ms`
  return `${value} ±${(stats.spread * 100).toFixed(0)}%`
}

/** Within this fraction the delta is called noise (⚪); beyond it, 🟢/🔴. */
const SIGNIFICANT = 0.05

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
const statOf = (workerRun: WorkerRun, metric: 'valid' | 'invalid'): Stats | null | 'failed' => {
  if (workerRun === 'failed') return 'failed'
  return workerRun?.[metric] ?? null
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

  if (suites.has('parsers')) console.error('generate-parsers (parse ops/s)…')
  for (const parseCase of suites.has('parsers') ? parsersSchemas.PARSE_CASES : []) {
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

  if (suites.has('validators')) console.error('generate-validators (validate ops/s)…')
  for (const benchCase of suites.has('validators') ? validatorsSchemas.BENCH_CASES : []) {
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

  // The api case table is import-cheap by design (setups load lazily), so
  // pulling the names from the head tree needs no built packages.
  const apiCases = (await import(pathToFileURL(join(head, 'packages/api/bench/cases.ts')).href)) as {
    API_BENCH_CASES: readonly { name: string }[]
  }

  if (suites.has('api')) console.error('api (request req/s)…')
  for (const benchCase of suites.has('api') ? apiCases.API_BENCH_CASES : []) {
    const { base: baseResult, head: headResult } = abbaPair(
      (tree) => runWorker(tree, 'api', benchCase.name, false),
      betterOps,
    )
    progress({
      suite: 'api',
      caseName: benchCase.name,
      metric: 'req/s',
      higherIsBetter: true,
      base: statOf(baseResult, 'valid'),
      head: statOf(headResult, 'valid'),
      parityOk: pairParityOk(baseResult, headResult),
    })
  }

  if (suites.has('codegen')) console.error('parser codegen (ms per buildSchema)…')
  for (const parseCase of suites.has('codegen') ? parsersSchemas.PARSE_CASES : []) {
    const pair = abbaPair((tree) => codegenStats(tree, parseCase.schema, parseCase.mode), betterMs)
    progress({
      suite: 'codegen',
      caseName: parseCase.name,
      metric: 'ms/parser',
      higherIsBetter: false,
      base: pair.base,
      head: pair.head,
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
