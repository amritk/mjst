import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { API_BENCH_CASES } from './cases.ts'
import { measureAsync, type Stats } from './measure.ts'

const BENCH_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * Runs `bench/worker.ts` exactly as scripts/bench-compare.ts spawns it in CI
 * (same argv protocol; no development condition, so workspace deps resolve to
 * their built dist — `pretest` builds @amritk/runtime-validators), with tiny
 * MJST_BENCH_* budgets so the smoke test measures wiring, not throughput.
 */
const runWorker = (caseName: string): string =>
  execFileSync('bun', [join(BENCH_DIR, 'worker.ts'), caseName, 'mjst'], {
    encoding: 'utf8',
    cwd: BENCH_DIR,
    env: { ...process.env, MJST_BENCH_WARMUP_MS: '10', MJST_BENCH_TRIALS: '3', MJST_BENCH_TRIAL_MS: '5' },
  })

describe('bench harness', () => {
  it('declares uniquely named cases for the delta table', () => {
    expect(API_BENCH_CASES.length).toBeGreaterThan(0)
    const names = API_BENCH_CASES.map((benchCase) => benchCase.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('measureAsync reports coherent statistics', async () => {
    const stats = await measureAsync(async () => 200, { warmupMs: 5, trials: 5, trialBudgetMs: 5 })
    expect(stats.trials).toBe(5)
    expect(stats.median).toBeGreaterThan(0)
    expect(stats.min).toBeLessThanOrEqual(stats.median)
    expect(stats.max).toBeGreaterThanOrEqual(stats.median)
    expect(stats.spread).toBeGreaterThanOrEqual(0)
  })

  it('the worker emits the WorkerOutput shape bench-compare consumes, for a runtime case', () => {
    const output = JSON.parse(runWorker('static GET (runtime)')) as { valid: Stats }
    expect(output.valid.median).toBeGreaterThan(0)
    expect(output.valid.trials).toBe(3)
  }, 30_000)

  it('the worker compiles and times the compiled engine case', () => {
    const output = JSON.parse(runWorker('POST, body validated (compiled)')) as { valid: Stats }
    expect(output.valid.median).toBeGreaterThan(0)
  }, 30_000)

  it('rejects unknown case names with the wording bench-compare treats as benign', () => {
    expect(() => runWorker('no such case')).toThrow(/unknown bench case/)
  }, 30_000)
})
