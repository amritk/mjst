/**
 * One isolated measurement, mirroring the worker protocol of the
 * generate-parsers/generate-validators benches: the orchestrator
 * (`scripts/bench-compare.ts`) spawns a fresh process per (tree, case) so the
 * two checkouts never share JIT state, and reads a single JSON line from
 * stdout in the `{ valid: Stats }` shape its delta table consumes.
 *
 *   usage: bun bench/worker.ts <caseName> mjst
 *
 * Runs without the development condition (unlike the parser/validator
 * workers): `@amritk/runtime-validators` must resolve to its built dist,
 * both because its sources use `@/` aliases Bun cannot resolve across
 * package boundaries and because the compiled artifact is what production
 * traffic runs — build it first (`bun run --filter='@amritk/runtime-validators' build`).
 *
 * The MJST_BENCH_* environment overrides exist for the smoke test, which
 * exercises this exact entry point with tiny budgets.
 */
import { API_BENCH_CASES } from './cases.ts'
import { measureAsync } from './measure.ts'

const [caseName] = process.argv.slice(2)

const benchCase = API_BENCH_CASES.find((candidate) => candidate.name === caseName)
// The exact "unknown bench case" wording is load-bearing: bench-compare
// treats it as the benign "case not in this tree yet" outcome.
if (!benchCase) throw new Error(`unknown bench case: ${caseName}`)

const envInt = (name: string): number | undefined => {
  const raw = process.env[name]
  if (raw === undefined) return undefined
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

const op = await benchCase.setup()
const stats = await measureAsync(op, {
  warmupMs: envInt('MJST_BENCH_WARMUP_MS'),
  trials: envInt('MJST_BENCH_TRIALS'),
  trialBudgetMs: envInt('MJST_BENCH_TRIAL_MS'),
})

process.stdout.write(JSON.stringify({ valid: stats }))
