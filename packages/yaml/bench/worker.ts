import { parse as reference } from 'yaml'

// The measurement core is shared, not copied: the canonical implementation
// lives in generate-parsers/bench/measure.ts and the other bench packages
// reach for it the same way. Bench code is unpublished dev tooling, so the
// cross-package relative import is deliberate.
import { measure, type Stats } from '../../generate-parsers/bench/measure.ts'
import { parse, parseDocument } from '../src/index'
import { YAML_BENCH_CASES } from './cases.ts'
import { FIXTURES } from './fixtures.ts'

/**
 * One isolated parse measurement, in the worker protocol
 * `scripts/bench-compare.ts` expects: a fresh process per (tree, case) so the
 * two checkouts never share JIT state, and a single JSON line on stdout.
 *
 *   usage: bun bench/worker.ts <caseName> mjst
 *
 * Parity is checked against `yaml` (eemeli) — the other YAML 1.2 parser in
 * this bench's devDependencies. Throughput from a parser that has started
 * producing the wrong tree is meaningless, and a "regression" that is really
 * a correctness change should say so in the table rather than read as a win.
 */

export type WorkerResult = {
  parityOk: boolean
  valid: Stats
}

const [caseName] = process.argv.slice(2)

const benchCase = YAML_BENCH_CASES.find((candidate) => candidate.name === caseName)
// The exact "unknown bench case" wording is load-bearing: bench-compare treats
// it as the benign "case not in this tree yet" outcome rather than harness
// breakage, so a tree that predates a case reports n/a instead of failing.
if (!benchCase) throw new Error(`unknown bench case: ${caseName}`)
const source = FIXTURES[benchCase.fixture]

let parityOk = false
try {
  parityOk = Bun.deepEquals(parse(source), reference(source))
} catch {
  parityOk = false
}

// Pool of distinct string identities carrying the same document, so the timed
// loop is not calling a pure parser on one loop-invariant value the optimiser
// could hoist out. A trailing comment is the cheapest way to vary identity
// without varying the parse work.
const pool = Array.from({ length: 8 }, (_, i) => `${source}# pool ${i}\n`)

const op = (benchCase.mode === 'tree' ? parseDocument : parse) as (input: unknown) => unknown

process.stdout.write(JSON.stringify({ parityOk, valid: measure(op, pool) } satisfies WorkerResult))
