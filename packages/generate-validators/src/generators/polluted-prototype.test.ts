import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { buildValidatorSchema } from './build-schema'

/**
 * Generation must read every keyword as the node's *own* property, so what comes
 * out depends on the document and nothing else.
 *
 * The generators walk schemas the caller supplied, and a bare `'items' in schema`
 * walks the prototype chain. With `Object.prototype.items` set — by a dependency
 * with a prototype-pollution bug, or by a schema built over a base object — every
 * node in the document answered "yes" to a keyword none of them declared, and the
 * result was not a crash but a *different validator*: an inherited `items: false`
 * capped every array at zero elements, an inherited `patternProperties` swallowed
 * the `additionalProperties` sweep so unknown keys stopped being reported, and an
 * inherited `contains` sent the ref walk into unbounded recursion (the value it
 * read inherited the keyword too, forever).
 *
 * `@amritk/helpers/schema-guards` and `@amritk/runtime-validators` already ask
 * `Object.hasOwn`; this pins the same answer for the keywords with no named
 * guard.
 */

/** Every keyword the generators branch on, with a value that would change the output. */
const POLLUTED_KEYWORDS: Record<string, unknown> = {
  type: 'string',
  enum: ['nope'],
  const: 'nope',
  $ref: '#/$defs/missing',
  properties: { injected: { type: 'number' } },
  patternProperties: { '^x-': { type: 'number' } },
  additionalProperties: false,
  required: ['injected'],
  propertyNames: { maxLength: 1 },
  dependentRequired: { a: ['b'] },
  dependentSchemas: { a: { required: ['b'] } },
  dependencies: { a: ['b'] },
  minProperties: 5,
  maxProperties: 1,
  items: false,
  prefixItems: [{ type: 'number' }],
  additionalItems: false,
  contains: { type: 'number' },
  minContains: 2,
  maxContains: 3,
  minItems: 3,
  maxItems: 1,
  uniqueItems: true,
  allOf: [{ type: 'number' }],
  anyOf: [{ type: 'number' }],
  oneOf: [{ type: 'number' }],
  not: { type: 'number' },
  if: { type: 'number' },
  then: { type: 'number' },
  else: { type: 'number' },
  unevaluatedProperties: false,
  unevaluatedItems: false,
  nullable: true,
  minLength: 4,
  maxLength: 1,
  pattern: '^nope$',
  minimum: 10,
  maximum: 1,
  multipleOf: 7,
  'x-mjst': { instanceOf: 'Date' },
}

/** A document touching the object, array, combinator and `$ref` paths at once. */
const SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    nested: { type: 'object', properties: { flag: { type: 'boolean' } }, required: ['flag'] },
    ref: { $ref: '#/$defs/detail' },
    choice: { anyOf: [{ type: 'string' }, { type: 'number' }] },
  },
  required: ['name'],
  additionalProperties: false,
  $defs: { detail: { type: 'object', properties: { id: { type: 'integer' } } } },
}

/**
 * The generated *code*: every emitted file from its first `export const` on.
 *
 * The `export type` line above it is rendered by
 * `@amritk/helpers/generate-type-definition`, which reads `schema.type` and
 * friends straight off the node — so an inherited `type` still widens the type it
 * writes. That is a fix for the helper (and for the three other generators that
 * share it) rather than for this package, and it changes a type annotation, never
 * a verdict. What this file pins is the verdict: the validator and its guard.
 */
const generate = async (): Promise<string> => {
  const files = await buildValidatorSchema(SCHEMA, 'Doc')
  return files
    .map((file) => {
      const code = file.content.indexOf('export const')
      return `// ${file.filename}\n${code === -1 ? file.content : file.content.slice(code)}`
    })
    .join('\n')
}

/** Runs `body` with one key defined on `Object.prototype`, and always removes it. */
const withPollutedPrototype = async (keyword: string, value: unknown, body: () => Promise<void>): Promise<void> => {
  // Non-enumerable, so this reproduces the *read* hazard without also changing
  // what `for…in` and `Object.keys` see — a stricter test of the guards.
  Object.defineProperty(Object.prototype, keyword, { value, writable: true, enumerable: false, configurable: true })
  try {
    await body()
  } finally {
    delete (Object.prototype as Record<string, unknown>)[keyword]
  }
}

describe('polluted-prototype', () => {
  it('generates the same validators whatever Object.prototype carries', async () => {
    const clean = await generate()

    for (const [keyword, value] of Object.entries(POLLUTED_KEYWORDS)) {
      await withPollutedPrototype(keyword, value, async () => {
        expect(await generate(), `an inherited "${keyword}" changed the generated validators`).toBe(clean)
      })
    }
  })

  it('generates for a schema whose own prototype carries keywords', async () => {
    // The likelier shape in practice: not a poisoned global, just a schema built
    // over a base object (a config merge, a class instance, `Object.create`).
    const base = { type: 'array', items: false, additionalProperties: false }
    const derived = Object.create(base) as Record<string, unknown>
    derived['type'] = 'object'
    derived['properties'] = { name: { type: 'string' } }
    derived['required'] = ['name']

    const files = await buildValidatorSchema(derived as JSONSchema, 'Doc')
    const doc = files.find((file) => file.filename === 'doc.ts')?.content ?? ''

    expect(doc).toContain("must have required property 'name'")
    expect(doc).not.toContain('must NOT have more than 0 items')
    expect(doc).not.toContain('must NOT have additional properties')
  })
})
