/**
 * The `moltar/typescript-runtime-type-benchmarks` fixture and harness shape,
 * reproduced so `moltar.ts` can measure this package's *parsers* under the
 * conditions that produce the public leaderboard's numbers.
 *
 * Written as plain JavaScript, not TypeScript, on purpose: the worker runs under
 * Node as well as Bun (the leaderboard publishes Node numbers, this repo benches
 * on Bun), and Node cannot import this package's TypeScript sources. It is the
 * parser-side twin of `generate-validators/bench/moltar-data.mjs`, and the two
 * agree on the fixture character for character.
 *
 * Two details of the upstream fixture matter and are easy to lose in a
 * paraphrase:
 *
 *   1. `parseData` is `Object.freeze(...)` — the leaderboard's cases run against
 *      a *non-extensible* object.
 *   2. It is one shared module-level constant, and `run()` throws the result
 *      away — both of which give an optimiser room to delete the call it is
 *      supposed to be timing. That is exactly what this benchmark exists to
 *      measure, so the `observed` mode below keeps the result alive as a
 *      control.
 */
import { Type } from '@sinclair/typebox'
import { z } from 'zod'

/** The upstream fixture, character for character — including the freeze. */
export const parseData = Object.freeze({
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

/** `parseData` plus undeclared keys at both levels — what a parseSafe case strips. */
export const parseDataWithExtras = Object.freeze({
  ...parseData,
  extra: 'drop me',
  deeplyNested: { ...parseData.deeplyNested, nestedExtra: 1 },
})

/**
 * moltar's `Benchmark` base class, reproduced in shape: the benchmarked function
 * is a *class property*, so every timed call is a load-then-call through an
 * object field rather than a direct call to a known function.
 */
export class Benchmark {
  constructor(moduleName, fn) {
    this.moduleName = moduleName
    this.fn = fn
  }
}

/** Faithful to upstream: call, throw the parsed value away. */
export class ParseDiscarded extends Benchmark {
  run() {
    this.fn(parseData)
  }
}

/**
 * The same call with the result observed. Anything an engine can delete under
 * `ParseDiscarded` it cannot delete here, so the pair measures how much of a
 * "result" is really dead-code elimination — which is the whole question for a
 * parser, whose result is a fresh allocation.
 */
export class ParseObserved extends Benchmark {
  constructor(moduleName, fn) {
    super(moduleName, fn)
    this.sink = 0
  }

  run() {
    this.sink += this.fn(parseData).number
  }
}

/**
 * The assert-benchmark JSON Schema: every root property required, `deeplyNested`
 * inline with all three fields required. `closed` shuts both objects to
 * undeclared keys, which is how the strict case rejects them.
 */
export const parseSchema = (closed) => ({
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
      ...(closed ? { additionalProperties: false } : {}),
    },
  },
  required: ['number', 'negNumber', 'maxNumber', 'string', 'longString', 'boolean', 'deeplyNested'],
  ...(closed ? { additionalProperties: false } : {}),
})

/** The TypeBox equivalent of {@link parseSchema}. */
export const parseTypebox = (closed) => {
  const options = closed ? { additionalProperties: false } : {}
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

/** The Zod equivalent of {@link parseSchema}: `.object` strips, `.strictObject` rejects. */
export const parseZod = (closed) => {
  const nestedFields = { foo: z.string(), num: z.number(), bool: z.boolean() }
  const nested = closed ? z.strictObject(nestedFields) : z.object(nestedFields)
  const rootFields = {
    number: z.number(),
    negNumber: z.number(),
    maxNumber: z.number(),
    string: z.string(),
    longString: z.string(),
    boolean: z.boolean(),
    deeplyNested: nested,
  }
  return closed ? z.strictObject(rootFields) : z.object(rootFields)
}

/**
 * The two parse cases, matching `schemas.ts`:
 *
 *   - **parseSafe** — assert the types and *strip* undeclared keys. The schema is
 *     open; mjst runs `strict + stripUnknown`.
 *   - **parseStrict** — assert the types and *reject* undeclared keys. The schema
 *     closes every object; mjst runs plain `strict`.
 */
export const MOLTAR_PARSE_CASES = ['parseSafe', 'parseStrict']

/** Whether a case closes its objects to undeclared keys. */
export const isStrictCase = (caseName) => caseName === 'parseStrict'

/** The two harness modes, so a "result" that is really elimination is visible. */
export const MOLTAR_MODES = ['discarded', 'observed']
