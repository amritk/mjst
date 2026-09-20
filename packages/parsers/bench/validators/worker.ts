/**
 * One isolated measurement. The orchestrator (`run.ts`) spawns a fresh process
 * running this file for every (case, library) pair, so each library is timed
 * alone — its call sites stay monomorphic and its allocations never perturb
 * another library's GC. The worker validates parity (a library that disagrees
 * on the verdict makes its throughput meaningless), times the valid and invalid
 * samples, and writes a single JSON line to stdout for the parent to collect.
 *
 *   usage: bun bench/worker.ts <caseName> <libraryId>
 */
import { measure, type Stats } from './measure.ts'
import { BENCH_CASES } from './schemas.ts'
import { buildValidator, type LibraryId } from './validators.ts'

export type WorkerResult = {
  parityOk: boolean
  parityDetail: string
  valid: Stats
  invalid: Stats
}

const [caseName, libId] = process.argv.slice(2) as [string, LibraryId]

const benchCase = BENCH_CASES.find((c) => c.name === caseName)
if (!benchCase) throw new Error(`unknown bench case: ${caseName}`)

const fn = await buildValidator(libId, benchCase)

/**
 * Freezes `value` and everything reachable from it. `structuredClone` always
 * hands back a *mutable* copy, so a frozen case has to re-freeze each pool
 * member itself — cloning first and freezing after is what keeps the pool made
 * of distinct object identities.
 */
const deepFreeze = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

/** One pool member: a fresh clone of `sample`, frozen when the case asks for it. */
const prepare = (sample: unknown): unknown => {
  const clone = structuredClone(sample)
  return benchCase.freezeInputs ? deepFreeze(clone) : clone
}

// Parity: the library must accept the valid sample and reject every invalid
// one. Report it rather than throw, so the orchestrator can flag a disagreement
// in the table instead of aborting the whole run. Judged on samples prepared
// exactly like the timed pool, so a frozen case also proves each library gives
// the same verdict on a frozen input (a validator that quietly wrote to its
// input would throw here rather than post a fast, wrong number).
const validSample = prepare(benchCase.valid)
const invalidSample = prepare(benchCase.invalid)
let parityOk = fn(validSample) === true && fn(invalidSample) === false
for (const sample of benchCase.extraInvalid ?? []) {
  if (fn(prepare(sample)) !== false) parityOk = false
}
const parityDetail = `${fn(validSample)}/${fn(invalidSample)}`

// Pool of distinct deep clones so the timed loop cycles fresh object identities
// rather than hammering one frozen value — the input is no longer loop-invariant,
// so the optimiser can't hoist a pure validator's call out of the loop. 32 keeps
// the pool in cache while still being plainly non-constant.
//
// A `freezeInputs` case deep-freezes each clone afterwards. The pool is still 32
// distinct identities, so nothing about the DCE resistance changes; what changes
// is the *shape* the engine sees, and on JavaScriptCore a non-extensible object
// makes every key sweep (`Object.keys`, `for...in`) take a generic slow path.
const pool = (sample: unknown): unknown[] => Array.from({ length: 32 }, () => prepare(sample))

const result: WorkerResult = {
  parityOk,
  parityDetail,
  valid: measure(fn, pool(benchCase.valid)),
  invalid: measure(fn, pool(benchCase.invalid)),
}

process.stdout.write(JSON.stringify(result))
