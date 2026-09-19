import { buildSchema } from '@amritk/generate-parsers'
import { transformSync } from 'esbuild'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { buildValidatorSchema } from './build-schema'
import { linkGenerated } from './link-generated.test-utils'

/**
 * `repairX` against the coercing parser, on the same schema and the same input.
 *
 * These are the repo's two answers to "make this document usable", and they now
 * repair toward the same table — `getDefaultValue`, which is why it was hoisted
 * into `@amritk/helpers` rather than copied. That shared table is only worth
 * having if it actually produces the same document from both sides, and nothing
 * but a differential proves it does: the parser repairs inline as it builds,
 * `repairX` repairs afterwards from the validator's errors, and two routes to
 * one answer is exactly the shape that drifts silently.
 *
 * Where they are *allowed* to differ is stated as its own case at the bottom, so
 * a change to either side has to move a test rather than slip through.
 */

type Parse = (input: unknown) => unknown
type RepairResult = { valid: boolean; value: unknown; repairs: unknown[] }
type Repair = (input: unknown) => RepairResult
type Validate = (input: unknown) => true | { valid: false; errors: unknown[] }

/**
 * Links a `buildSchema` result the same way {@link linkGenerated} links a
 * validator set. The parser emits helper modules under `_helpers/`, so the two
 * generators' outputs need the same in-memory module resolution — and the
 * parsers package has no linker of its own to borrow.
 */
const linkParser = (files: readonly { filename: string; content: string }[], exportName: string): Parse => {
  const sources = new Map(files.map((file) => [file.filename.replace(/\.ts$/, ''), file.content]))
  const loaded = new Map<string, Record<string, unknown>>()

  const resolve = (specifier: string, fromDir: string): string => {
    const bare = specifier.replace(/^\.\//, '').replace(/\.js$/, '')
    const joined = fromDir === '' ? bare : `${fromDir}/${bare}`
    const normalized: string[] = []
    for (const segment of joined.split('/')) {
      if (segment === '.') continue
      if (segment === '..') normalized.pop()
      else normalized.push(segment)
    }
    return normalized.join('/')
  }

  const load = (specifier: string, fromDir: string): Record<string, unknown> => {
    const key = resolve(specifier, fromDir)
    const cached = loaded.get(key)
    if (cached !== undefined) return cached
    const source = sources.get(key)
    if (source === undefined) throw new Error(`generated parser output has no module "${specifier}"`)

    const module = { exports: {} as Record<string, unknown> }
    loaded.set(key, module.exports)
    const js = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
    const dir = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : ''
    new Function('module', 'exports', 'require', js)(module, module.exports, (nested: string) => load(nested, dir))
    loaded.set(key, module.exports)
    return module.exports
  }

  return load('index', '')[exportName] as Parse
}

/** Both engines for one schema, ready to be handed the same document. */
const build = async (schema: JSONSchema): Promise<{ parse: Parse; repair: Repair; validate: Validate }> => {
  const validatorFiles = await buildValidatorSchema(
    schema,
    'Root',
    '',
    undefined,
    'count-keys',
    undefined,
    false,
    false,
    true,
  )
  const parserFiles = await buildSchema(
    schema,
    'Root',
    undefined, // extensions
    false, // typesOnly
    false, // logWarnings
    false, // strict — the coercing mode, the one that repairs
    'embedded', // helpersMode — so the linked set is self-contained
    './', // helpersImportPrefix
    false, // readonly
    false, // stripUnknown
  )

  return {
    parse: linkParser(parserFiles, 'parseRoot'),
    repair: linkGenerated<Repair>(validatorFiles, 'index', 'repairRoot'),
    validate: linkGenerated<Validate>(validatorFiles, 'index', 'validateRoot'),
  }
}

const schema: JSONSchema = {
  type: 'object',
  properties: {
    retries: { type: 'integer', minimum: 0, maximum: 10, default: 3 },
    mode: { type: 'string', enum: ['fast', 'slow'] },
    name: { type: 'string', minLength: 3 },
    ratio: { type: 'number', multipleOf: 0.5 },
    flag: { type: 'boolean' },
    inner: {
      type: 'object',
      properties: { a: { type: 'string', minLength: 2 }, b: { type: 'integer', minimum: 5 } },
      required: ['a', 'b'],
    },
    items: {
      type: 'array',
      items: { type: 'object', properties: { qty: { type: 'integer', minimum: 1 } }, required: ['qty'] },
    },
  },
  required: ['name', 'retries', 'inner'],
}

/** Documents chosen to land on a different repair path each. */
const AGREED: readonly (readonly [string, unknown])[] = [
  ['nothing to do', { name: 'Ada', retries: 5, inner: { a: 'ab', b: 9 } }],
  ['scalars in the wrong type', { name: 'Ada', retries: '5', flag: 'true', inner: { a: 'ab', b: '9' } }],
  ['a required property with a default', { name: 'Ada', inner: { a: 'ab', b: 9 } }],
  ['a required property without one', { retries: 5, inner: { a: 'ab', b: 9 } }],
  ['a number outside its bounds', { name: 'Ada', retries: 99, inner: { a: 'ab', b: 9 } }],
  ['a string below minLength', { name: 'Al', retries: 5, inner: { a: 'ab', b: 9 } }],
  ['a value off the enum', { name: 'Ada', retries: 5, mode: 'FAST', inner: { a: 'ab', b: 9 } }],
  ['a violated multipleOf', { name: 'Ada', retries: 5, ratio: 1.3, inner: { a: 'ab', b: 9 } }],
  ['a whole missing object', { name: 'Ada', retries: 5 }],
  ['an object missing everything', { name: 'Ada', retries: 5, inner: {} }],
  ['a bad element inside an array', { name: 'Ada', retries: 5, inner: { a: 'ab', b: 9 }, items: [{ qty: 0 }] }],
  ['an element missing its key', { name: 'Ada', retries: 5, inner: { a: 'ab', b: 9 }, items: [{}] }],
  ['a root of the wrong kind entirely', 'nope'],
  ['a root that is null', null],
  ['a root that is an array', [1, 2, 3]],
]

describe('repairX against the coercing parser', () => {
  it.each(AGREED)('repairs %s to the same document', async (_label, input) => {
    const { parse, repair, validate } = await build(schema)

    const repaired = repair(input)

    expect(repaired.valid).toBe(true)
    expect(repaired.value).toEqual(parse(input))
    // Neither side is the oracle for *validity* — the validator is. A repair both
    // engines agree on is still wrong if the schema rejects it.
    expect(validate(repaired.value)).toBe(true)
  })

  it('reports a repair for everything it changed, and none for what it only coerced', async () => {
    const { repair } = await build(schema)

    const coercedOnly = repair({ name: 'Ada', retries: '5', inner: { a: 'ab', b: '9' } })
    const genuinelyRepaired = repair({ name: 'Al', retries: 99, inner: { a: 'ab', b: 9 } })

    expect(coercedOnly.repairs).toEqual([])
    expect(genuinelyRepaired.repairs).toHaveLength(2)
  })

  it('pads a short array where the parser leaves one invalid', async () => {
    // The one place the two deliberately part company. `getDefaultValue` builds a
    // *missing* array at its `minItems` length, so a partial array padded to the
    // same length is that policy carried through; the parser hands back the short
    // array it was given, which does not satisfy the schema it was repaired
    // against. Ours is the answer the invariant demands, so this is a difference
    // worth keeping rather than one to reconcile.
    const withMinItems: JSONSchema = {
      type: 'object',
      properties: { xs: { type: 'array', minItems: 2, items: { type: 'integer', minimum: 1 } } },
      required: ['xs'],
    }
    const { parse, repair, validate } = await build(withMinItems)
    const input = { xs: [7] }

    const repaired = repair(input)

    expect(repaired.value).toEqual({ xs: [7, 1] })
    expect(validate(repaired.value)).toBe(true)
    expect(parse(input)).toEqual({ xs: [7] })
    expect(validate(parse(input))).not.toBe(true)
  })
})
