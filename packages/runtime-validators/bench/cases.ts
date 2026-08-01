import { BENCH_CASES } from './schemas.ts'

/**
 * The case list the isolated worker (`worker.ts`) and the PR-delta comparison
 * (`scripts/bench-compare.ts`) share. `run.ts` stays the cross-library surface
 * (us vs Ajv, cold and steady-state); these cases exist to compare *this*
 * interpreter against itself across two checkouts, so they cover only our own
 * two entry points.
 *
 * Both modes are timed because they exercise different halves of the
 * interpreter: `validateGuard` short-circuits on the first failure and is
 * documented as allocation-free, while `validate` walks the whole value and
 * builds an error array. A regression can land in either without touching the
 * other — an extra allocation on the guard path is invisible to the
 * error-collecting numbers, and a change to error-path formatting is invisible
 * to the guard's.
 *
 * The cold one-shot path — this package's headline claim against Ajv — is
 * deliberately *not* here. Measuring it needs a schema object the per-validator
 * `WeakMap` in `prepare.ts` has never seen, so a timed loop would have to
 * allocate a fresh deep clone per operation and would end up timing
 * `structuredClone`. `run.ts` measures it properly with its own fixed-iteration
 * harness; this table's job is to catch interpreter regressions, and the
 * steady-state walk is the most sensitive detector of those.
 */

/** Which entry point a case times. */
export type RuntimeBenchMode = 'guard' | 'errors'

export type RuntimeBenchCase = {
  /** Case name as it appears in the delta table and on the worker's argv. */
  readonly name: string
  /** Name of the {@link BENCH_CASES} entry supplying the schema and samples. */
  readonly schemaCase: string
  readonly mode: RuntimeBenchMode
}

export const RUNTIME_BENCH_CASES: readonly RuntimeBenchCase[] = BENCH_CASES.flatMap((benchCase) =>
  (['guard', 'errors'] as const).map((mode) => ({
    name: `${benchCase.name} (${mode})`,
    schemaCase: benchCase.name,
    mode,
  })),
)
