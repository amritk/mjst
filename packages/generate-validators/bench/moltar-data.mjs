/**
 * The `moltar/typescript-runtime-type-benchmarks` fixture and harness shape,
 * reproduced verbatim so `moltar.ts` can measure this repo's validators under
 * the conditions that produce the public leaderboard's numbers.
 *
 * Written as plain JavaScript, not TypeScript, on purpose: the workers run under
 * both Bun and Node (quantifying the runtime gap is half the point of this
 * harness), and Node cannot import this package's TypeScript sources.
 *
 * Two details of the upstream fixture matter and are easy to lose in a
 * paraphrase, which is why this file does not just reuse `schemas.ts`:
 *
 *   1. `validateData` is `Object.freeze(...)` — so the leaderboard's assert
 *      cases run against a *non-extensible* object, and on JavaScriptCore that
 *      is a different (much slower) workload for anything enforcing
 *      `additionalProperties: false`. See the `(frozen)` cases in `schemas.ts`.
 *   2. It is one shared module-level constant, and `run()` throws the result
 *      away — both of which give an optimiser room to delete the call it is
 *      supposed to be timing.
 */
import { Type } from '@sinclair/typebox'
import { z } from 'zod'

/** The upstream fixture, character for character — including the freeze. */
export const validateData = Object.freeze({
  number: 1,
  negNumber: -1,
  maxNumber: Number.MAX_VALUE,
  string: 'string',
  longString:
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut ' +
    'labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco ' +
    'laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in ' +
    'voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat ' +
    'non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Vivendum intellegat ' +
    'et qui, ei denique consequuntur vix. Semper aeterno percipit ut his, sea ex utinam referrentur ' +
    'repudiandae. No epicuri hendrerit consetetur sit, sit dicta adipiscing ex, in facete detracto ' +
    'deterruisset duo. Quot populo ad qui. Sit fugit nostrum et. Ad per diam dicant interesset, lorem ' +
    'iusto sensibus ut sed. No dicam aperiam vis. Pri posse graeco definitiones cu, id eam populo ' +
    'quaestio adipiscing, usu quod malorum te. Ex nam agam veri, dicunt efficiantur ad qui, ad legere ' +
    'adversarium sit. Commune platonem mel id, brute adipiscing duo an. Vivendum intellegat et qui, ' +
    'ei denique consequuntur vix. Offendit eleifend moderatius ex vix, quem odio mazim et qui, purto ' +
    'expetendis cotidieque quo cu, veri persius vituperata ei nec. Duis aute irure dolor in ' +
    'reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
  boolean: true,
  deeplyNested: {
    foo: 'bar',
    num: 1,
    bool: false,
  },
})

/**
 * moltar's `Benchmark` base class, reproduced in shape: the benchmarked function
 * is a *class property*, so every timed call is a load-then-call through an
 * object field rather than a direct call to a known function. `assertLoose` /
 * `assertStrict` both implement `run()` as `this.fn(validateData)` — the result
 * is discarded, which is what `MODES.discarded` reproduces.
 */
export class Benchmark {
  constructor(moduleName, fn) {
    this.moduleName = moduleName
    this.fn = fn
  }
}

/** Faithful to upstream: call, throw the answer away. */
export class AssertDiscarded extends Benchmark {
  run() {
    this.fn(validateData)
  }
}

/**
 * The same call with the verdict observed. Anything an engine can delete under
 * `AssertDiscarded` it cannot delete here, so the pair measures how much of a
 * "result" is really dead-code elimination.
 */
export class AssertObserved extends Benchmark {
  constructor(moduleName, fn) {
    super(moduleName, fn)
    this.sink = 0
  }

  run() {
    if (this.fn(validateData) === true) this.sink++
  }
}

/**
 * The assert-benchmark JSON Schema: every root property required, `deeplyNested`
 * inline with all three fields required. `strict` closes both objects.
 */
export const assertSchema = (strict) => ({
  type: 'object',
  properties: {
    number: { type: 'number' },
    negNumber: { type: 'number' },
    maxNumber: { type: 'number' },
    string: { type: 'string' },
    longString: { type: 'string' },
    boolean: { type: 'boolean' },
    deeplyNested: {
      type: 'object',
      properties: {
        foo: { type: 'string' },
        num: { type: 'number' },
        bool: { type: 'boolean' },
      },
      required: ['foo', 'num', 'bool'],
      ...(strict ? { additionalProperties: false } : {}),
    },
  },
  required: ['number', 'negNumber', 'maxNumber', 'string', 'longString', 'boolean', 'deeplyNested'],
  ...(strict ? { additionalProperties: false } : {}),
})

/** The TypeBox equivalent of {@link assertSchema}. */
export const assertTypebox = (strict) => {
  const options = strict ? { additionalProperties: false } : {}
  return Type.Object(
    {
      number: Type.Number(),
      negNumber: Type.Number(),
      maxNumber: Type.Number(),
      string: Type.String(),
      longString: Type.String(),
      boolean: Type.Boolean(),
      deeplyNested: Type.Object({ foo: Type.String(), num: Type.Number(), bool: Type.Boolean() }, options),
    },
    options,
  )
}

/** The Zod equivalent of {@link assertSchema}. */
export const assertZod = (strict) => {
  const nestedFields = { foo: z.string(), num: z.number(), bool: z.boolean() }
  const nested = strict ? z.strictObject(nestedFields) : z.object(nestedFields)
  const rootFields = {
    number: z.number(),
    negNumber: z.number(),
    maxNumber: z.number(),
    string: z.string(),
    longString: z.string(),
    boolean: z.boolean(),
    deeplyNested: nested,
  }
  return strict ? z.strictObject(rootFields) : z.object(rootFields)
}

/** The two assert cases the leaderboard publishes, keyed by the name used on it. */
export const MOLTAR_CASES = ['assertLoose', 'assertStrict']

/** Whether a case closes its objects to undeclared keys. */
export const isStrictCase = (caseName) => caseName === 'assertStrict'
