import { FIXTURES } from './fixtures'

/**
 * The case list the isolated worker (`worker.ts`) and the PR-delta comparison
 * (`scripts/bench-compare.ts`) share. `run.ts` stays the cross-library
 * comparison surface; these cases exist to compare *this* parser against
 * itself across two checkouts, so they cover only our own two entry points.
 *
 * Both modes are timed because they exercise different halves of the parser:
 * `parseDocument` builds the source-mapped tree (the job this package exists
 * for), while `parse` additionally walks that tree into plain data — a
 * regression can land in either without touching the other.
 */

/** Which entry point a case times. */
export type YamlBenchMode = 'tree' | 'data'

export type YamlBenchCase = {
  /** Case name as it appears in the delta table and on the worker's argv. */
  readonly name: string
  readonly fixture: keyof typeof FIXTURES
  readonly mode: YamlBenchMode
}

const FIXTURE_NAMES = Object.keys(FIXTURES) as (keyof typeof FIXTURES)[]

export const YAML_BENCH_CASES: readonly YamlBenchCase[] = FIXTURE_NAMES.flatMap((fixture) =>
  (['tree', 'data'] as const).map((mode) => ({ name: `${fixture} (${mode})`, fixture, mode })),
)
