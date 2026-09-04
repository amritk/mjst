/**
 * mjst under the leaderboard's own process model: all four cases, one process.
 *
 * `moltar-worker.mjs` isolates one (case, library, mode) per process, which is
 * what upstream does *per library* — but inside that process upstream runs
 * every case the library registered, back to back, in registration order:
 * `parseSafe`, `parseStrict`, `assertLoose`, `assertStrict`. Four generated
 * modules sharing one V8 heap is a different workload from one module alone
 * (shared helpers see more call sites, inline caches see more shapes), and the
 * public numbers come from the former. This worker reproduces it for mjst.
 *
 *   usage: <bun|node> bench/moltar-leaderboard-worker.mjs <modulesDir>
 *
 * `modulesDir` holds one transpiled module per case, `<case>/index.js`, built by
 * `moltar-leaderboard.ts`. Output is one JSON line: an array of
 * `{ case, ops, margin, samples }` in the order the cases ran.
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import benny from 'benny'

import { Benchmark, validateData } from './moltar-data.mjs'

/**
 * Upstream's `run()` for every case: call, throw the result away. One class per
 * case, as upstream has, and not one shared class: `run` is a method, so a
 * single class would give the four cases one `this.fn` call site, which sees
 * four different functions and stops inlining any of them — a third off every
 * number, from the harness alone.
 */
class ParseSafe extends Benchmark {
  run() {
    this.fn(validateData)
  }
}
class ParseStrict extends Benchmark {
  run() {
    this.fn(validateData)
  }
}
class AssertLoose extends Benchmark {
  run() {
    this.fn(validateData)
  }
}
class AssertStrict extends Benchmark {
  run() {
    this.fn(validateData)
  }
}

const [modulesDir] = process.argv.slice(2)
if (!modulesDir) throw new Error('usage: moltar-leaderboard-worker.mjs <modulesDir>')

const load = (caseName) => import(pathToFileURL(join(modulesDir, caseName, 'index.js')).href)

/**
 * moltar's assert contract: return true, throw on invalid. Written out once per
 * case rather than through one shared factory, because a case file writes them
 * out too — and closures from one source site share their type feedback, so a
 * shared wrapper would hand the two validators one call site between them.
 */
const assertLoose = async () => {
  const { validateAssertLoose } = await load('assertLoose')
  return (input) => {
    if (validateAssertLoose(input) !== true) throw new Error('invalid')
    return true
  }
}
const assertStrict = async () => {
  const { validateAssertStrict } = await load('assertStrict')
  return (input) => {
    if (validateAssertStrict(input) !== true) throw new Error('invalid')
    return true
  }
}

const withExtra = { ...validateData, extraAttribute: true }
const withNestedExtra = { ...validateData, deeplyNested: { ...validateData.deeplyNested, extraNestedAttribute: 'bar' } }
const { number: _dropped, ...missingNumber } = validateData
const wrongType = { ...validateData, number: 'foo' }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const throws = (fn, input) => {
  try {
    fn(input)
  } catch {
    return true
  }
  return false
}

/**
 * The four cases in upstream's registration order, each with the parity checks
 * upstream's own vitest suite makes before a number is accepted — so a figure
 * here can only come from a function that passes the leaderboard's tests.
 */
const CASES = [
  {
    name: 'parseSafe',
    Case: ParseSafe,
    build: async () => (await load('parseSafe')).parseParseSafe,
    check: (fn) =>
      same(fn(validateData), validateData) &&
      same(fn(withExtra), validateData) &&
      same(fn(withNestedExtra), validateData) &&
      throws(fn, missingNumber) &&
      throws(fn, wrongType),
  },
  {
    name: 'parseStrict',
    Case: ParseStrict,
    build: async () => (await load('parseStrict')).parseParseStrict,
    check: (fn) =>
      same(fn(validateData), validateData) &&
      throws(fn, wrongType) &&
      throws(fn, withExtra) &&
      throws(fn, withNestedExtra) &&
      throws(fn, missingNumber),
  },
  {
    name: 'assertLoose',
    Case: AssertLoose,
    build: assertLoose,
    check: (fn) =>
      fn(validateData) === true && fn(withExtra) === true && throws(fn, wrongType) && throws(fn, missingNumber),
  },
  {
    name: 'assertStrict',
    Case: AssertStrict,
    build: assertStrict,
    check: (fn) =>
      fn(validateData) === true &&
      throws(fn, withExtra) &&
      throws(fn, withNestedExtra) &&
      throws(fn, wrongType) &&
      throws(fn, missingNumber),
  },
]

// Every module is loaded before any case is timed, as upstream's registration
// does, so the later cases run against a heap the earlier ones already shaped.
const benchmarks = []
for (const c of CASES) {
  const fn = await c.build()
  if (!c.check(fn)) throw new Error(`mjst failed the leaderboard's ${c.name} tests`)
  benchmarks.push({ name: c.name, benchmark: new c.Case('mjst', fn) })
}

// benny at its defaults, one suite per case, sequentially — upstream's
// `runBenchmarks`, minus the `cycle()`/`complete()` reporters whose only job is
// to print. stdout is reserved for the JSON line the orchestrator parses.
const log = console.log
console.log = () => {}
const results = []
for (const { name, benchmark } of benchmarks) {
  const summary = await benny.suite(
    name,
    benny.add('mjst', () => benchmark.run()),
  )
  const [result] = summary.results
  results.push({ case: name, ops: result.ops, margin: result.margin, samples: result.details.sampleResults.length })
}
console.log = log
process.stdout.write(JSON.stringify(results))
