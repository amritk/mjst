/**
 * One isolated leaderboard-conditions measurement.
 *
 * `moltar.ts` spawns a fresh process running this file for every
 * (case, library, mode) triple, under each runtime being compared — the same
 * isolation upstream uses ("isolated node processes for each benchmarked
 * package"), and the same isolation this package's own `worker.ts` uses. Inside,
 * the measurement is benny driving moltar's `Benchmark` shape, so the number it
 * prints is directly comparable with the public leaderboard rather than with
 * this repo's `measure.ts`.
 *
 * Plain JavaScript because it has to run under Node as well as Bun, and Node
 * cannot import this package's TypeScript sources. The one thing it cannot build
 * for itself is the mjst validator (that needs the generator, which is
 * TypeScript); the orchestrator generates and transpiles it first and passes the
 * module path in.
 *
 *   usage: <bun|node> bench/moltar-worker.mjs <caseName> <libraryId> <mode> [mjstModule]
 */

import { TypeCompiler } from '@sinclair/typebox/compiler'
import Ajv from 'ajv'
import benny from 'benny'

import {
  AssertDiscarded,
  AssertObserved,
  assertSchema,
  assertTypebox,
  assertZod,
  isStrictCase,
  validateData,
} from './moltar-data.mjs'

const [caseName, libId, mode, mjstModule] = process.argv.slice(2)
const strict = isStrictCase(caseName)

/**
 * Builds the boolean checker for one library — the same construction this
 * package's `validators.ts` uses, so the two tables time the same functions and
 * only the harness around them differs. `noop` is the control: a function that
 * validates nothing, which pins benny's own per-operation cost.
 */
const buildChecker = async () => {
  switch (libId) {
    case 'noop':
      return () => true
    case 'mjst': {
      const mod = await import(mjstModule)
      const validate = mod[strict ? 'validateAssertStrict' : 'validateAssertLoose']
      return (input) => validate(input) === true
    }
    case 'typia': {
      // Only reachable under Bun, where the orchestrator adds typia's transform
      // preload; the transform is a build step Node cannot host here.
      const { typiaValidators } = await import('./typia-validators.ts')
      return typiaValidators[strict ? 'assert-strict' : 'assert-loose']
    }
    case 'ajv': {
      const ajv = new Ajv({ strict: false })
      const validate = ajv.compile(assertSchema(strict))
      return (input) => validate(input) === true
    }
    case 'typebox': {
      const checker = TypeCompiler.Compile(assertTypebox(strict))
      return (input) => checker.Check(input)
    }
    case 'zod': {
      const schema = assertZod(strict)
      return (input) => schema.safeParse(input).success
    }
    default:
      throw new Error(`unknown library: ${libId}`)
  }
}

const checker = await buildChecker()

/**
 * moltar's assert contract is "return true, throw on invalid", so each library
 * enters the suite behind the same one-line wrapper a leaderboard entry would
 * carry. On the valid fixture it never throws, so what gets timed is the
 * checker plus that wrapper — not error construction.
 */
const asserted = (input) => {
  if (checker(input) !== true) throw new Error('invalid')
  return true
}

// Parity, so a number can only come from a checker that is really checking.
// The `noop` control is exempt by construction — accepting everything is the
// whole point of it, and its row is labelled as the harness floor.
if (libId !== 'noop') {
  if (asserted(validateData) !== true) throw new Error(`${libId} rejected the moltar fixture`)
  if (strict && checker({ ...validateData, extra: true }) !== false) {
    throw new Error(`${libId} accepted an undeclared key in a strict case`)
  }
}

const Case = mode === 'observed' ? AssertObserved : AssertDiscarded
const benchmark = new Case(libId, asserted)

// benny's own defaults, unchanged — they are what the leaderboard runs under.
// `cycle()` / `complete()` are left out, and benny's start-up banner is muted,
// so the worker's only stdout is the JSON line the orchestrator parses.
const log = console.log
console.log = () => {}
const summary = await benny.suite(
  caseName,
  benny.add(libId, () => benchmark.run()),
)
console.log = log

const [result] = summary.results
process.stdout.write(
  JSON.stringify({ ops: result.ops, margin: result.margin, samples: result.details.sampleResults.length }),
)
