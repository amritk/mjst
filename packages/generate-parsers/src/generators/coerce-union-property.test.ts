import Ajv from 'ajv/dist/2020'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { buildSchema } from './build-schema'
import { linkGenerated } from './differential.test-utils'

/**
 * The last union position the coercing dispatcher did not reach: a union written
 * directly as a property value, rather than as a definition, an array's `items`,
 * or a `$ref`. Nothing claimed it, so a value matching no branch was handed back
 * untouched — the whole of the remaining invalid-output gap on the published
 * Scalar configuration schema, every one of it at `siteConfig.logo`, whose
 * `logo` is `anyOf: [<uri string>, { darkMode, lightMode }]`. With this wired,
 * that measurement is 0 of 4000.
 *
 * The second half of this file guards the *emitted* code rather than its
 * behaviour. A scalar branch is repaired by an inline expression that re-tests
 * the value's type, and TypeScript narrows inside the arm a guard opened: after
 * `if (typeof input === "boolean") return …`, the string arm of the boolean
 * token table reads `input.trim()` on `never` and the generated file does not
 * compile. That was reachable on `main` through a `$defs` union — the dispatcher
 * admits scalar branches there — so these cases pin the shape, not just the
 * property-position fix that first surfaced it.
 */
const ajv = new Ajv({ strict: false, ownProperties: true })

/** `siteConfig.logo` reduced: a union property whose branches are a `$ref` and an object. */
const UNION_PROPERTY = {
  type: 'object',
  properties: {
    siteConfig: {
      type: 'object',
      properties: {
        logo: {
          anyOf: [
            { $ref: '#/$defs/uri' },
            {
              type: 'object',
              properties: { darkMode: { type: 'string' }, lightMode: { type: 'string' } },
              required: ['darkMode', 'lightMode'],
            },
          ],
        },
      },
    },
  },
  $defs: { uri: { type: 'string' } },
} as unknown as JSONSchema

/** The same union, required rather than optional, to cover both emit paths. */
const REQUIRED_UNION_PROPERTY = {
  type: 'object',
  properties: {
    logo: {
      anyOf: [
        { type: 'object', properties: { src: { type: 'string' } }, required: ['src'] },
        {
          type: 'object',
          properties: { dark: { type: 'string' }, light: { type: 'string' } },
          required: ['dark', 'light'],
        },
      ],
    },
  },
  required: ['logo'],
} as unknown as JSONSchema

const coercingParserFor = async (schema: JSONSchema): Promise<(input: unknown) => unknown> => {
  const files = await buildSchema(
    schema,
    'Root',
    undefined,
    false,
    false,
    false,
    'embedded',
    './',
    false,
    false,
    '',
    'js',
  )
  return linkGenerated<(input: unknown) => unknown>(files, 'index', 'parseRoot')
}

describe('coerce-union-property', () => {
  it.each([
    ['an object branch with a mistyped member', { siteConfig: { logo: { darkMode: 1, lightMode: 'l.png' } } }],
    [
      'an object branch with a member of the wrong shape',
      { siteConfig: { logo: { darkMode: {}, lightMode: 'l.png' } } },
    ],
    ['an object branch missing a required member', { siteConfig: { logo: { darkMode: 'd.png' } } }],
    ['a value matching neither branch', { siteConfig: { logo: 5 } }],
    ['an empty object', { siteConfig: { logo: {} } }],
    ['null', { siteConfig: { logo: null } }],
    ['an array', { siteConfig: { logo: [] } }],
  ])('repairs %s into a document its own schema accepts', async (_label, document) => {
    const parse = await coercingParserFor(UNION_PROPERTY)

    const output = parse(structuredClone(document))

    expect(ajv.validate(structuredClone(UNION_PROPERTY), structuredClone(output))).toBe(true)
  })

  it.each([
    ['a required union property given junk', { logo: 5 }],
    ['a required union property missing entirely', {}],
    ['a required union property half-formed', { logo: { dark: 'd' } }],
  ])('repairs %s', async (_label, document) => {
    const parse = await coercingParserFor(REQUIRED_UNION_PROPERTY)

    const output = parse(structuredClone(document))

    expect(ajv.validate(structuredClone(REQUIRED_UNION_PROPERTY), structuredClone(output))).toBe(true)
  })

  it.each([
    ['the string branch', { siteConfig: { logo: 'https://example.com/logo.png' } }],
    ['the object branch', { siteConfig: { logo: { darkMode: 'd.png', lightMode: 'l.png' } } }],
    ['the property absent', { siteConfig: {} }],
  ])('returns an already-valid document unchanged for %s', async (_label, document) => {
    const parse = await coercingParserFor(UNION_PROPERTY)

    expect(parse(structuredClone(document))).toStrictEqual(document)
  })

  /**
   * Scoring, not position, decides the branch: the value carries both of the
   * object branch's required keys, so it is repaired toward that branch rather
   * than toward the string branch written first.
   */
  it('repairs toward the branch the value most resembles', async () => {
    const parse = await coercingParserFor(UNION_PROPERTY)

    const output = parse({ siteConfig: { logo: { darkMode: 1, lightMode: 2 } } }) as {
      siteConfig: { logo: Record<string, unknown> }
    }

    expect(output.siteConfig.logo).toHaveProperty('darkMode')
    expect(output.siteConfig.logo).toHaveProperty('lightMode')
  })

  it('emits a dispatching sub-parser for the union property, not a passthrough', async () => {
    const files = await buildSchema(
      UNION_PROPERTY,
      'Root',
      undefined,
      false,
      false,
      false,
      'embedded',
      './',
      false,
      false,
      '',
      'js',
    )
    const source = files.map((file) => file.content).join('\n')

    expect(source).toMatch(/const parseRoot_SiteConfig_LogoUnion = /)
  })

  /**
   * A strict parser's verdicts must not move: this is a coercion-only path, and
   * strict already enforced these unions through its own assertions.
   */
  it.each([
    [{ siteConfig: { logo: 'https://example.com/logo.png' } }],
    [{ siteConfig: { logo: { darkMode: 'd', lightMode: 'l' } } }],
    [{ siteConfig: { logo: { darkMode: 1, lightMode: 'l' } } }],
    [{ siteConfig: { logo: 5 } }],
    [{ siteConfig: {} }],
  ])('keeps the strict verdict in step with Ajv for %j', async (document) => {
    const files = await buildSchema(
      UNION_PROPERTY,
      'Root',
      undefined,
      false,
      false,
      true,
      'embedded',
      './',
      false,
      false,
      '',
      'js',
    )
    const parse = linkGenerated<(input: unknown) => unknown>(files, 'index', 'parseRoot')
    const accepted = ajv.validate(structuredClone(UNION_PROPERTY), structuredClone(document))

    let threw = false
    try {
      parse(structuredClone(document))
    } catch {
      threw = true
    }
    expect(threw).toBe(!accepted)
  })

  /**
   * The narrowing regression, pinned on the shape that reached it first. A
   * dispatcher over scalar branches must read its repaired value through a
   * binding the guards do not narrow, or the emitted file fails to compile —
   * which `generated-code-types.fuzz.test.ts` proves for the whole option matrix
   * and this proves for the exact `$defs` union that carried it.
   */
  it.each([
    ['boolean | string', { anyOf: [{ type: 'boolean' }, { type: 'string' }] }],
    ['number | boolean', { anyOf: [{ type: 'number' }, { type: 'boolean' }] }],
    ['enum | boolean', { anyOf: [{ enum: ['a', 'b'] }, { type: 'boolean' }] }],
  ])('reads a scalar-branch union through an unnarrowed binding for %s', async (_label, definition) => {
    const schema = {
      type: 'object',
      properties: { v: { $ref: '#/$defs/u' } },
      $defs: { u: definition },
    } as unknown as JSONSchema

    const files = await buildSchema(
      schema,
      'Root',
      undefined,
      false,
      false,
      false,
      'embedded',
      './',
      false,
      false,
      '',
      'js',
    )
    const source = files.find((file) => file.filename === 'u.ts')?.content ?? ''

    // The guard narrows `input`; the repaired value is read from `_u`, which it
    // cannot reach. Both halves matter — testing `_u` in the guard would narrow
    // the alias too and put the error straight back.
    expect(source).toContain('const _u: unknown = input;')
    expect(source).toMatch(/if \(typeof input === /)
    expect(source).not.toMatch(/if \(typeof _u === /)
  })

  it('leaves a union of objects reading `input` directly, with no alias to pay for', async () => {
    const files = await buildSchema(
      REQUIRED_UNION_PROPERTY,
      'Root',
      undefined,
      false,
      false,
      false,
      'embedded',
      './',
      false,
      false,
      '',
      'js',
    )
    const source = files.map((file) => file.content).join('\n')

    expect(source).not.toContain('const _u: unknown = input;')
  })
})
