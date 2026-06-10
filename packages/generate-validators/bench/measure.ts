/**
 * The measurement core shared by the benchmark workers. Kept deliberately small
 * and dependency-free so it can be imported into an isolated child process (see
 * `worker.ts`) without dragging the orchestrator's machinery along.
 *
 * Reliability comes from two things working together:
 *
 *   1. **Isolation** — each library is timed in its own fresh process (the
 *      orchestrator spawns one worker per library), so a call site never goes
 *      megamorphic across libraries and one library's allocations can't perturb
 *      another's GC. This mirrors the methodology switch upstream
 *      (`moltar/typescript-runtime-type-benchmarks`) made to "isolated node
 *      processes for each benchmarked package".
 *   2. **Repetition + statistics** — instead of one timed window we take many,
 *      and report the median plus the spread. A single window is noisy; the
 *      median of many is stable, and the spread tells you whether to trust it.
 */

/** Summary statistics over the per-trial throughput samples (operations/sec). */
export type Stats = {
  /** Median operations/sec — the headline figure, robust to the odd slow trial. */
  median: number
  /** Fastest trial — the cleanest run, least disturbed by GC / scheduling. */
  max: number
  /** Slowest trial. */
  min: number
  /** Mean operations/sec across trials. */
  mean: number
  /**
   * Relative spread `(max - min) / median`, as a fraction. A small spread means
   * the median is reproducible; a large one is a warning the number is noisy.
   */
  spread: number
  /** Number of timed trials behind the statistics. */
  trials: number
}

/** Tunables for {@link measure}; the defaults give stable numbers in ~3s/measurement. */
export type MeasureOptions = {
  /** Milliseconds of untimed warmup, to let the JIT settle before timing. */
  warmupMs?: number
  /** Number of timed trials to take. */
  trials?: number
  /** Milliseconds each timed trial runs for. */
  trialBudgetMs?: number
}

/**
 * Times `fn` and returns throughput statistics. Warms up untimed, then runs
 * `trials` independent timed windows; each window busy-loops `fn` for
 * `trialBudgetMs` and records its operations/sec. The samples are reduced to a
 * median (headline) plus min/max/mean and a relative spread.
 */
export const measure = (fn: () => void, options: MeasureOptions = {}): Stats => {
  const warmupMs = options.warmupMs ?? 300
  const trials = options.trials ?? 15
  const trialBudgetMs = options.trialBudgetMs ?? 120

  const warmupEnd = performance.now() + warmupMs
  while (performance.now() < warmupEnd) fn()

  const samples: number[] = []
  for (let t = 0; t < trials; t++) {
    let ops = 0
    const start = performance.now()
    const end = start + trialBudgetMs
    do {
      for (let i = 0; i < 1000; i++) fn()
      ops += 1000
    } while (performance.now() < end)
    const elapsed = performance.now() - start
    samples.push(ops / (elapsed / 1000))
  }

  samples.sort((a, b) => a - b)
  const min = samples[0] ?? 0
  const max = samples[samples.length - 1] ?? 0
  const median = samples[Math.floor(samples.length / 2)] ?? 0
  const mean = samples.reduce((sum, s) => sum + s, 0) / samples.length
  const spread = median > 0 ? (max - min) / median : 0

  return { median, max, min, mean, spread, trials }
}
