/**
 * Async counterpart to the measurement core in
 * `packages/generate-parsers/bench/measure.ts`, for timing the request
 * pipeline — `api.handle` and compiled fetch handlers are async, so the sync
 * `measure` over there cannot time them. Same protocol, same statistics:
 * untimed warmup so the JIT settles, many independent timed trials, the
 * median as the headline figure, and the coefficient of variation as the
 * stability signal. Each op resolves to a number (the response status) that
 * is folded into an escaping sink, so the optimiser cannot delete the work.
 */

/** Summary statistics over the per-trial throughput samples (requests/sec). */
export type Stats = {
  /** Median requests/sec — the headline figure, robust to the odd slow trial. */
  median: number
  /** Fastest trial. */
  max: number
  /** Slowest trial. */
  min: number
  /** Mean requests/sec across trials. */
  mean: number
  /** Coefficient of variation (stddev / mean), as a fraction. */
  spread: number
  /** Number of timed trials behind the statistics. */
  trials: number
}

/** Tunables for {@link measureAsync}; the defaults give stable numbers in ~2.5s/measurement. */
export type MeasureOptions = {
  /** Milliseconds of untimed warmup, to let the JIT settle before timing. */
  warmupMs?: number
  /** Number of timed trials to take. */
  trials?: number
  /** Milliseconds each timed trial runs for. */
  trialBudgetMs?: number
}

/**
 * Times `op` and returns throughput statistics. One operation per resolved
 * call; small batches amortize the clock read without hiding trial
 * boundaries.
 */
export const measureAsync = async (op: () => Promise<number>, options: MeasureOptions = {}): Promise<Stats> => {
  const warmupMs = options.warmupMs ?? 400
  const trials = options.trials ?? 21
  const trialBudgetMs = options.trialBudgetMs ?? 100

  // Escaping sink: observed after the loops so V8 cannot eliminate the ops.
  let sink = 0

  const warmupEnd = performance.now() + warmupMs
  while (performance.now() < warmupEnd) sink += await op()

  const samples: number[] = []
  for (let trial = 0; trial < trials; trial++) {
    let ops = 0
    const start = performance.now()
    const end = start + trialBudgetMs
    while (performance.now() < end) {
      for (let i = 0; i < 25; i++) sink += await op()
      ops += 25
    }
    samples.push((ops / (performance.now() - start)) * 1000)
  }

  if (!Number.isFinite(sink)) throw new Error('benchmark sink overflowed')

  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)] ?? 0
  const mean = samples.reduce((total, sample) => total + sample, 0) / samples.length
  const variance = samples.reduce((total, sample) => total + (sample - mean) ** 2, 0) / samples.length
  return {
    median,
    max: samples[samples.length - 1] ?? 0,
    min: samples[0] ?? 0,
    mean,
    spread: mean > 0 ? Math.sqrt(variance) / mean : 0,
    trials,
  }
}
