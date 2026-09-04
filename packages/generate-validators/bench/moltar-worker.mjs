/**
 * One leaderboard-conditions process: **one library, every mode it can host,
 * in upstream's order**.
 *
 * The process layout is the measurement here, not an implementation detail.
 * Upstream (`moltar/typescript-runtime-type-benchmarks`) runs an isolated
 * process per *package*, and inside it registers that package's four cases —
 * `parseSafe`, `parseStrict`, `assertLoose`, `assertStrict` — against one
 * imported module. So the second export a process touches is warmed up in a
 * process that has already optimised against the first, and anything the module
 * boundary costs per call compounds across the four. `moltar.ts` also spawns
 * this worker with a single mode, which is the control for exactly that: same
 * module, same suite, nothing having run before it.
 *
 * The mjst entry is required as **CommonJS** and every call reads the export off
 * the module object — `(0, mod.assertLoose)(data)`, never bound to a local
 * first. That is how upstream's compiled case consumes it, and it is the only
 * shape in which the export *kind* (data property vs accessor) can show up at
 * all: bind the function to a local before the loop and the module object is
 * never touched again, so a getter costs nothing and the whole effect
 * disappears. See `moltar.ts` for the two entry builds this is pointed at.
 *
 * Plain JavaScript because it has to run under Node as well as Bun, and Node
 * cannot import this package's TypeScript sources. The one thing it cannot build
 * for itself is the mjst entry (that needs the generators, which are
 * TypeScript); the orchestrator builds and compiles it first and passes the path
 * in.
 *
 *   usage: <bun|node> bench/moltar-worker.mjs <libraryId> <discarded|observed> <mode[,mode...]> [mjstEntry]
 */

import { createRequire } from 'node:module'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { Value } from '@sinclair/typebox/value'
import Ajv from 'ajv'
import benny from 'benny'

import {
  AssertObserved,
  assertSchema,
  assertTypebox,
  assertZod,
  Discarded,
  isParseMode,
  isStrictMode,
  ParseObserved,
  validateData,
} from './moltar-data.mjs'

const [libId, benchMode, modeList, mjstEntry] = process.argv.slice(2)
const modes = modeList.split(',')

const require = createRequire(import.meta.url)

/**
 * The generated mjst entry, loaded once for the whole process — the same single
 * import upstream's case file does. Loading it per mode would hand each mode its
 * own fresh module object and hide the very thing this worker exists to see.
 */
const mjst = libId === 'mjst' ? require(mjstEntry) : null

/**
 * typia's checks come from a compile-time transform, so this module only loads
 * (and only resolves) under Bun with the orchestrator's preload plugin
 * attached — hence the dynamic import rather than a static one.
 */
const typiaValidators = libId === 'typia' ? (await import('./typia-validators.ts')).typiaValidators : null

/** Libraries that answer a mode with `null` cannot host it; the table prints `n/a`. */
const UNSUPPORTED = null

/**
 * Builds the function to time for one mode. Every branch returns the operation
 * *as a leaderboard entry would expose it*: parse modes hand back a new value
 * and throw on invalid input, assert modes hand back a boolean that the
 * `asserted` wrapper below turns into upstream's throw-on-invalid contract.
 */
const buildOperation = (mode) => {
  const strict = isStrictMode(mode)

  switch (libId) {
    case 'noop':
      // The control: the fastest thing the harness can physically run. A parse
      // that parses nothing still has to answer with a value.
      return isParseMode(mode) ? (input) => input : () => true

    case 'mjst':
      // Deliberately four separate access sites reading `mjst.<name>` at call
      // time, mirroring upstream's compiled `(0, mod.fn)(data)`.
      // biome-ignore-start lint/complexity/noCommaOperator: this *is* the thing
      // being measured — it is character-for-character what TypeScript emits for
      // a call to an imported binding, and the only shape in which the export
      // kind can show up. Rewriting it to `mjst.fn(input)` would still read the
      // module object, but the bench would no longer be running upstream's code.
      switch (mode) {
        case 'parseSafe':
          return (input) => (0, mjst.parseSafe)(input)
        case 'parseStrict':
          return (input) => (0, mjst.parseStrict)(input)
        case 'assertLoose':
          return (input) => (0, mjst.assertLoose)(input) === true
        default:
          return (input) => (0, mjst.assertStrict)(input) === true
      }
    // biome-ignore-end lint/complexity/noCommaOperator: see above

    case 'typia': {
      // typia's stripping parse (`assertPrune`) mutates its input in place,
      // which is a different operation from the pure parse the other columns
      // run — and cannot run at all against moltar's frozen fixture.
      if (isParseMode(mode)) return UNSUPPORTED
      return typiaValidators[strict ? 'assert-strict' : 'assert-loose']
    }

    case 'ajv': {
      // Same exclusion as typia, for the same reason: ajv strips by mutating the
      // input (`removeAdditional`), so it has no pure parse to time.
      if (isParseMode(mode)) return UNSUPPORTED
      const ajv = new Ajv({ strict: false })
      const validate = ajv.compile(assertSchema(strict))
      return (input) => validate(input) === true
    }

    case 'typebox': {
      const schema = assertTypebox(strict)
      if (isParseMode(mode)) {
        // `Clone` first so the operation stays pure; `Clean` is what strips, so
        // it is in the safe pipeline only — the strict schema rejects instead.
        const pipeline = strict ? ['Clone', 'Assert'] : ['Clone', 'Clean', 'Assert']
        return (input) => Value.Parse(pipeline, schema, input)
      }
      const checker = TypeCompiler.Compile(schema)
      return (input) => checker.Check(input)
    }

    case 'zod': {
      const schema = assertZod(strict)
      // `.parse` on a non-strict object strips; on a `strictObject` it throws.
      if (isParseMode(mode)) return (input) => schema.parse(input)
      return (input) => schema.safeParse(input).success
    }

    default:
      throw new Error(`unknown library: ${libId}`)
  }
}

/**
 * moltar's assert contract is "return true, throw on invalid", so each library
 * enters the suite behind the same one-line wrapper a leaderboard entry would
 * carry. On the valid fixture it never throws, so what gets timed is the
 * checker plus that wrapper — not error construction. Parse operations already
 * carry that contract themselves and go in unwrapped.
 */
const asserted = (checker) => (input) => {
  if (checker(input) !== true) throw new Error('invalid')
  return true
}

/** True when `fn` rejects `input` by throwing — how every parser reports invalid. */
const rejects = (fn, input) => {
  try {
    fn(input)
    return false
  } catch {
    return true
  }
}

/**
 * Parity, so a number can only come from an operation that is really doing the
 * work. The `noop` control is exempt by construction — accepting everything is
 * the whole point of it, and its row is labelled as the harness floor.
 */
const assertParity = (mode, fn) => {
  if (libId === 'noop') return
  const withExtra = { ...validateData, extra: true }

  if (isParseMode(mode)) {
    const parsed = fn(validateData)
    if (parsed === null || typeof parsed !== 'object') throw new Error(`${libId} ${mode} returned no object`)
    if (parsed.number !== 1 || parsed.deeplyNested?.foo !== 'bar') {
      throw new Error(`${libId} ${mode} did not reproduce the fixture`)
    }
    if (isStrictMode(mode)) {
      if (!rejects(fn, withExtra)) throw new Error(`${libId} ${mode} accepted an undeclared key`)
    } else if ('extra' in fn(withExtra)) {
      throw new Error(`${libId} ${mode} did not strip an undeclared key`)
    }
    return
  }

  if (fn(validateData) !== true) throw new Error(`${libId} ${mode} rejected the moltar fixture`)
  if (isStrictMode(mode) && !rejects(fn, withExtra)) {
    throw new Error(`${libId} ${mode} accepted an undeclared key in a strict mode`)
  }
}

/**
 * Every mode's operation is built (and parity-checked) before any of them is
 * timed, the way upstream registers all of a package's cases up front. Building
 * them lazily, one immediately before its own suite, would put each library's
 * compile cost inside a different mode's warm-up.
 */
const operations = new Map()
for (const mode of modes) {
  const operation = buildOperation(mode)
  if (operation === UNSUPPORTED) {
    operations.set(mode, UNSUPPORTED)
    continue
  }
  const timed = isParseMode(mode) ? operation : asserted(operation)
  assertParity(mode, timed)
  operations.set(mode, timed)
}

// benny's own defaults, unchanged — they are what the leaderboard runs under.
// `cycle()` / `complete()` are left out, and benny's start-up banner is muted,
// so the worker's only stdout is the JSON line the orchestrator parses.
const log = console.log
console.log = () => {}

const results = {}
for (const mode of modes) {
  const timed = operations.get(mode)
  if (timed === UNSUPPORTED) {
    results[mode] = null
    continue
  }

  const observed = isParseMode(mode) ? ParseObserved : AssertObserved
  const Case = benchMode === 'observed' ? observed : Discarded
  const benchmark = new Case(libId, timed)

  const summary = await benny.suite(
    mode,
    benny.add(libId, () => benchmark.run()),
  )
  const [result] = summary.results
  results[mode] = { ops: result.ops, margin: result.margin, samples: result.details.sampleResults.length }
}

console.log = log
process.stdout.write(JSON.stringify(results))
