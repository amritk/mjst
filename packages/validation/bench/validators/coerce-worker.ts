/**
 * One isolated coercion measurement. The orchestrator (`coerce.ts`) spawns a
 * fresh process running this file for every (case, engine) pair, so each engine
 * is timed alone — its call sites stay monomorphic and its allocations never
 * perturb the other's GC, the same methodology the other two benches use.
 *
 * The worker records what each engine *did* with the three input classes before
 * timing them, because the headline question here is not only which is faster:
 * the two engines have different contracts, and a throughput number is only
 * worth reading next to the answer it produced.
 *
 *   usage: bun bench/coerce-worker.ts <caseName> <engineId>
 */
import { isDeepStrictEqual } from 'node:util'

import { COERCE_CASES } from './coerce-cases.ts'
import { acceptedValue, buildCoercer, type EngineId } from './coercers.ts'
import { measure, type Stats } from './measure.ts'

export type WorkerResult = {
  /**
   * Whether the engine coerced both the clean and the coercible sample onto the
   * case's valid document. The one claim both contracts have to answer the same
   * way — and the precondition for the throughput numbers meaning anything, since
   * an engine that skipped the work would post a fast, wrong number.
   */
  agreesOnValid: boolean
  /** How the engine answered the input no coercion can fix: `repair` or `reject`. */
  unrepairableVerdict: 'repair' | 'reject'
  clean: Stats
  coercible: Stats
  unrepairable: Stats
}

const [caseName, engine] = process.argv.slice(2) as [string, EngineId]

const coerceCase = COERCE_CASES.find((candidate) => candidate.name === caseName)
if (!coerceCase) throw new Error(`unknown coerce case: ${caseName}`)

const coerce = await buildCoercer(engine, coerceCase)

/** Runs one sample and reduces it to the value the engine produced, or `null`. */
const answer = (sample: unknown): unknown => acceptedValue(engine, coerce(structuredClone(sample)))

const agreesOnValid =
  isDeepStrictEqual(answer(coerceCase.clean), coerceCase.clean) &&
  isDeepStrictEqual(answer(coerceCase.coercible), coerceCase.clean)

// A parser repairs toward defaults and so always hands back a value; a coercing
// validator hands back errors. Recorded rather than asserted: this difference is
// the finding, not a failure.
const unrepairableVerdict = answer(coerceCase.unrepairable) === null ? 'reject' : 'repair'

// Pool of distinct deep clones so the timed loop cycles fresh object identities
// rather than hammering one value — the input is no longer loop-invariant, so the
// optimiser cannot hoist a pure call out of the loop. Both engines are pure (they
// return the input by reference when nothing moved, and a copy when something
// did), so reusing a pool across trials is safe. 32 keeps it in cache while
// staying plainly non-constant.
const pool = (sample: unknown): unknown[] => Array.from({ length: 32 }, () => structuredClone(sample))

const result: WorkerResult = {
  agreesOnValid,
  unrepairableVerdict,
  clean: measure(coerce, pool(coerceCase.clean)),
  coercible: measure(coerce, pool(coerceCase.coercible)),
  unrepairable: measure(coerce, pool(coerceCase.unrepairable)),
}

process.stdout.write(JSON.stringify(result))
