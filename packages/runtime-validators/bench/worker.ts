import Ajv from 'ajv'
import addFormats from 'ajv-formats'

// The measurement core is shared, not copied: the canonical implementation
// lives in generate-parsers/bench/measure.ts and the other bench packages
// reach for it the same way. Bench code is unpublished dev tooling, so the
// cross-package relative import is deliberate.
import { measure, type Stats } from '../../generate-parsers/bench/measure.ts'
import { RUNTIME_BENCH_CASES } from './cases.ts'
import { BENCH_CASES } from './schemas.ts'

// Imported by package name, not as `../src/index.ts`, and therefore timed as
// the built `dist` rather than the TypeScript sources — bench-compare spawns
// this worker with `developConditions: false` to match. The sources reach for
// each other through the package's `@/*` path alias, which Bun only resolves
// against the tsconfig in its working directory; the worker runs with `cwd`
// set to this bench directory, so a source-level import dies on
// `Cannot find module '@/interpreter/prepare'`. The api workers time this same
// package the same way, for the same reason, and dist is what production
// traffic runs anyway.
const { validate, validateGuard } = await import('@amritk/runtime-validators')

/**
 * One isolated validation measurement, in the worker protocol
 * `scripts/bench-compare.ts` expects: a fresh process per (tree, case) so the
 * two checkouts never share JIT state, and a single JSON line on stdout.
 *
 *   usage: bun bench/worker.ts <caseName> mjst
 *
 * Parity is checked against Ajv — the reference this package's differential
 * test already holds it to. Throughput from an interpreter that has started
 * returning the wrong verdict is meaningless, and a "win" that is really a
 * correctness change should say so in the table rather than read as a speedup.
 */

export type WorkerResult = {
  parityOk: boolean
  valid: Stats
  invalid: Stats
}

const [caseName] = process.argv.slice(2)

const benchCase = RUNTIME_BENCH_CASES.find((candidate) => candidate.name === caseName)
// The exact "unknown bench case" wording is load-bearing: bench-compare treats
// it as the benign "case not in this tree yet" outcome rather than harness
// breakage, so a tree that predates a case reports n/a instead of failing.
if (!benchCase) throw new Error(`unknown bench case: ${caseName}`)

const schemaCase = BENCH_CASES.find((candidate) => candidate.name === benchCase.schemaCase)
if (!schemaCase) throw new Error(`unknown bench case: ${benchCase.schemaCase}`)

// `validate` returns `true | { valid: false, errors }` — the failure object is
// truthy, so handing it to `measure` unwrapped would make its escaping sink
// count invalid input as a pass. Normalising to a boolean keeps the sink
// honest for both modes without changing what work is timed.
const guard = validateGuard(schemaCase.schema)
const collect = validate(schemaCase.schema)
const fn =
  benchCase.mode === 'guard'
    ? (input: unknown): boolean => guard(input)
    : (input: unknown): boolean => collect(input) === true

// Parity: the interpreter must agree with Ajv on both samples. Report it
// rather than throw, so the orchestrator can flag a disagreement in the table
// instead of aborting the whole run.
let parityOk = false
try {
  const ajv = new Ajv({ allErrors: false, strict: false })
  addFormats(ajv)
  const reference = ajv.compile(schemaCase.schema)
  parityOk =
    fn(schemaCase.valid) === reference(schemaCase.valid) && fn(schemaCase.invalid) === reference(schemaCase.invalid)
} catch {
  parityOk = false
}

// Pool of distinct deep clones so the timed loop cycles fresh object
// identities rather than hammering one frozen value — the input is no longer
// loop-invariant, so the optimiser can't hoist a pure validator's call out of
// the loop. 32 keeps the pool in cache while still being plainly non-constant.
// The schema, by contrast, is deliberately shared: reusing one prepared
// validator is exactly the steady-state path these cases exist to time.
const pool = (sample: unknown): unknown[] => Array.from({ length: 32 }, () => structuredClone(sample))

const result: WorkerResult = {
  parityOk,
  valid: measure(fn, pool(schemaCase.valid)),
  invalid: measure(fn, pool(schemaCase.invalid)),
}

process.stdout.write(JSON.stringify(result))
