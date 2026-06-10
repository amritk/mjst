/**
 * The measurement core shared by the benchmark workers. Kept deliberately small
 * and dependency-free so it can be imported into an isolated child process (see
 * `worker.ts`) without dragging the orchestrator's machinery along.
 *
 * Reliability comes from three things working together:
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
 *   3. **DCE/LICM resistance** — the validator runs over a *pool of distinct
 *      object identities* (not one frozen value) and its verdict is folded into
 *      an escaping sink. Without this, V8 hoists a pure validator's call out of
 *      the loop (loop-invariant code motion) or eliminates it entirely (dead
 *      code) for libraries whose generated code it can see through — e.g. typia,
 *      whose inlined checks would otherwise report billions of impossible
 *      ops/sec. Cycling distinct inputs and observing the result keeps every
 *      library doing the work it claims to.
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
   * Coefficient of variation (stddev / mean), as a fraction. The conventional
   * micro-benchmark stability measure: small means the median is reproducible,
   * large warns the number is noisy. Preferred over a raw min/max range, which a
   * single GC-stalled trial would blow out of proportion.
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
 * Times `validate` over `inputs` and returns throughput statistics. Warms up
 * untimed, then runs `trials` independent timed windows; each window cycles
 * through the input pool calling `validate`, folding each verdict into a sink so
 * the optimiser cannot delete the work. Counts one operation per `validate`
 * call. The samples are reduced to a median (headline) plus min/max/mean and a
 * relative spread.
 */
export const measure = (
  validate: (input: unknown) => unknown,
  inputs: readonly unknown[],
  options: MeasureOptions = {},
): Stats => {
  const warmupMs = options.warmupMs ?? 400
  const trials = options.trials ?? 21
  const trialBudgetMs = options.trialBudgetMs ?? 100
  const n = inputs.length

  // Escaping sink: folding the verdict in here, and forcing it to be observed
  // after the loop, stops V8 eliminating or hoisting the validator call.
  let sink = 0
  let k = 0

  const warmupEnd = performance.now() + warmupMs
  while (performance.now() < warmupEnd) {
    if (validate(inputs[k])) sink++
    k = k + 1 === n ? 0 : k + 1
  }

  const samples: number[] = []
  for (let t = 0; t < trials; t++) {
    let ops = 0
    const start = performance.now()
    const end = start + trialBudgetMs
    do {
      for (let i = 0; i < 1000; i++) {
        if (validate(inputs[k])) sink++
        k = k + 1 === n ? 0 : k + 1
      }
      ops += 1000
    } while (performance.now() < end)
    const elapsed = performance.now() - start
    samples.push(ops / (elapsed / 1000))
  }

  // `sink` only ever grows, but V8 can't prove that across the opaque validator
  // boundary, so this guard keeps the accumulation (and the calls) alive.
  if (sink < 0) throw new Error('unreachable')

  samples.sort((a, b) => a - b)
  const min = samples[0] ?? 0
  const max = samples[samples.length - 1] ?? 0
  const median = samples[Math.floor(samples.length / 2)] ?? 0
  const mean = samples.reduce((sum, s) => sum + s, 0) / samples.length
  const variance = samples.reduce((sum, s) => sum + (s - mean) ** 2, 0) / samples.length
  const spread = mean > 0 ? Math.sqrt(variance) / mean : 0

  return { median, max, min, mean, spread, trials }
}
