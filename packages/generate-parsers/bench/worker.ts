/**
 * One isolated parse measurement. The orchestrator (`run.ts`) spawns a fresh
 * process running this file for every (case, library) pair, so each library is
 * timed alone — its call sites stay monomorphic and its allocations never
 * perturb another library's GC. The worker checks parity (a parser that produces
 * the wrong stripped object, or fails to reject invalid input, makes its
 * throughput meaningless), times the valid sample, and writes a single JSON line
 * to stdout for the parent to collect.
 *
 *   usage: bun bench/worker.ts <caseName> <libraryId>
 */
import { measure, type Stats } from './measure.ts'
import { buildParser, type LibraryId } from './parsers.ts'
import { PARSE_CASES } from './schemas.ts'

export type WorkerResult = {
  parityOk: boolean
  parityDetail: string
  valid: Stats
}

const [caseName, libId] = process.argv.slice(2) as [string, LibraryId]

const parseCase = PARSE_CASES.find((c) => c.name === caseName)
if (!parseCase) throw new Error(`unknown parse case: ${caseName}`)

const parse = await buildParser(libId, parseCase)

// Parity has two halves: the parser must (1) produce exactly the `expected`
// object from `input` (stripped extras in safe mode, the clean value unchanged in
// strict mode), and (2) reject every `mustThrow` sample by throwing — wrong types
// in both modes, plus extra keys in strict mode. Report rather than throw so the
// orchestrator can flag a disagreement in the table instead of aborting.
let outputOk = false
try {
  outputOk = Bun.deepEquals(parse(parseCase.input), parseCase.expected)
} catch {
  outputOk = false
}

const throws = (sample: unknown): boolean => {
  try {
    parse(sample)
    return false
  } catch {
    return true
  }
}
const rejectsAll = parseCase.mustThrow.every(throws)

const parityOk = outputOk && rejectsAll
const verb = parseCase.mode === 'safe' ? 'strip' : 'keep'
const parityDetail = `${outputOk ? `${verb}✓` : `${verb}✗`} ${rejectsAll ? 'reject✓' : 'reject✗'}`

// Pool of distinct deep clones so the timed loop cycles fresh object identities
// rather than hammering one frozen value — the input is no longer loop-invariant,
// so the optimiser can't hoist a pure parser's call out of the loop. Every parser
// here is pure (returns a new object, leaves the input untouched), so reusing the
// pool across trials is safe. 32 keeps the pool in cache while staying non-constant.
const pool = Array.from({ length: 32 }, () => structuredClone(parseCase.input))

const result: WorkerResult = {
  parityOk,
  parityDetail,
  valid: measure(parse, pool),
}

process.stdout.write(JSON.stringify(result))
