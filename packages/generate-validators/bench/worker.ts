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

// Parity: the library must accept the valid sample and reject every invalid
// one. Report it rather than throw, so the orchestrator can flag a disagreement
// in the table instead of aborting the whole run.
let parityOk = fn(benchCase.valid) === true && fn(benchCase.invalid) === false
for (const sample of benchCase.extraInvalid ?? []) {
  if (fn(sample) !== false) parityOk = false
}
const parityDetail = `${fn(benchCase.valid)}/${fn(benchCase.invalid)}`

const result: WorkerResult = {
  parityOk,
  parityDetail,
  valid: measure(() => fn(benchCase.valid)),
  invalid: measure(() => fn(benchCase.invalid)),
}

process.stdout.write(JSON.stringify(result))
