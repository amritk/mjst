import { describe, expect, it } from 'vitest'

import { collectValidatorImports } from './collect-validator-imports'

describe('collect-validator-imports', () => {
  it('collects a direct property $ref', () => {
    const schema = { properties: { contact: { $ref: '#/$defs/contact' } } }

    expect(collectValidatorImports(schema)).toEqual(["import { type Contact, validateContact } from './contact.js'"])
  })

  it('collects $refs inside inline nested objects', () => {
    // The validator generator recurses into inline nested objects, so a $ref
    // buried inside one has to become an import too or the generated file
    // would reference a validator it never imported.
    const schema = {
      properties: {
        profile: {
          type: 'object' as const,
          properties: {
            address: { $ref: '#/$defs/address' },
            contacts: { type: 'array' as const, items: { $ref: '#/$defs/contact' } },
          },
        },
      },
    }

    expect(collectValidatorImports(schema)).toEqual([
      "import { type Address, validateAddress } from './address.js'",
      "import { type Contact, validateContact } from './contact.js'",
    ])
  })

  it('collects a $ref inside dependentSchemas', () => {
    // The validator emits `dependentSchemas` subschema checks, so a $ref reached
    // only through one must still be imported.
    const schema = {
      type: 'object' as const,
      properties: { a: { type: 'string' as const } },
      dependentSchemas: { a: { $ref: '#/$defs/extra' } },
    }

    expect(collectValidatorImports(schema)).toEqual(["import { type Extra, validateExtra } from './extra.js'"])
  })

  it('collects a $ref inside a draft-07 schema-form dependency', () => {
    // The emitter delegates schema-form `dependencies` via `validateX`, so a $ref
    // reached only through one must be imported (else the file calls an undefined
    // symbol). The array form carries only strings and contributes no import.
    const schema = {
      type: 'object' as const,
      properties: { a: { type: 'string' as const } },
      dependencies: { a: { $ref: '#/$defs/needB' }, b: ['a'] },
    }

    expect(collectValidatorImports(schema)).toEqual(["import { type NeedB, validateNeedB } from './need-b.js'"])
  })

  it('deduplicates a ref that appears both directly and inside a nested object', () => {
    const schema = {
      properties: {
        owner: { $ref: '#/$defs/contact' },
        profile: {
          type: 'object' as const,
          properties: { backup: { $ref: '#/$defs/contact' } },
        },
      },
    }

    expect(collectValidatorImports(schema)).toEqual(["import { type Contact, validateContact } from './contact.js'"])
  })

  it('collects refs the emitter delegates for via patternProperties, contains, prefixItems and if/then/else', () => {
    // Every one of these keywords makes the emitter emit a `validateX(...)` call,
    // so each referenced validator has to be imported or the output references an
    // undefined symbol. The old traversal covered none of these paths.
    const schema = {
      type: 'object' as const,
      patternProperties: { '^x-': { $ref: '#/$defs/ext' } },
      propertyNames: { $ref: '#/$defs/name' },
      if: { $ref: '#/$defs/cond' },
      then: { $ref: '#/$defs/ontrue' },
      else: { $ref: '#/$defs/onfalse' },
      properties: {
        list: {
          type: 'array' as const,
          contains: { $ref: '#/$defs/needle' },
          prefixItems: [{ $ref: '#/$defs/first' }],
        },
        branch: { oneOf: [{ $ref: '#/$defs/variant' }] },
      },
    }

    // Order follows traversal order (properties → patternProperties → single
    // subschema keywords). The point of the test is that NONE are dropped.
    expect(collectValidatorImports(schema)).toEqual([
      "import { type Needle, validateNeedle } from './needle.js'",
      "import { type First, validateFirst } from './first.js'",
      "import { type Variant, validateVariant } from './variant.js'",
      "import { type Ext, validateExt } from './ext.js'",
      "import { type Name, validateName } from './name.js'",
      "import { type Cond, validateCond } from './cond.js'",
      "import { type Ontrue, validateOntrue } from './ontrue.js'",
      "import { type Onfalse, validateOnfalse } from './onfalse.js'",
    ])
  })

  // A `$ref` in a branch the emitter folds away is a ref nothing ever calls. The
  // opposite mistake is the dangerous one — a call with no import is a name
  // nothing defines — so `matchesEverything` is deliberately narrower than the
  // emitter's own fold test, and these pin both directions.
  it('skips a $ref in a branch the emitter folds away', () => {
    const rootSchema = { $defs: { a: { type: 'string' }, b: { type: 'number' } } }
    const names = (schema: unknown): string[] =>
      collectValidatorImports(schema as never, { rootSchema }).map((line) => /validate(\w+)/.exec(line)?.[1] ?? line)

    // An always-matching `anyOf` branch makes the whole keyword vacuous.
    expect(names({ anyOf: [{ $ref: '#/$defs/a' }, true] })).toEqual([])
    expect(names({ anyOf: [{ $ref: '#/$defs/a' }, {}] })).toEqual([])
    expect(names({ anyOf: [{ $ref: '#/$defs/a' }, { title: 'annotation only' }] })).toEqual([])
    // A statically-known `if` takes one arm and drops the other.
    expect(names({ if: {}, then: { $ref: '#/$defs/a' }, else: { $ref: '#/$defs/b' } })).toEqual(['A'])
    expect(names({ if: false, then: { $ref: '#/$defs/a' }, else: { $ref: '#/$defs/b' } })).toEqual(['B'])
  })

  it('keeps every $ref the emitter still reaches', () => {
    const rootSchema = { $defs: { a: { type: 'string' }, b: { type: 'number' } } }
    const names = (schema: unknown): string[] =>
      collectValidatorImports(schema as never, { rootSchema }).map((line) => /validate(\w+)/.exec(line)?.[1] ?? line)

    // `oneOf` and `allOf` are never folded — a `true` branch changes their
    // verdict rather than making them vacuous.
    expect(names({ oneOf: [{ $ref: '#/$defs/a' }, true] })).toEqual(['A'])
    expect(names({ allOf: [{ $ref: '#/$defs/a' }, true] })).toEqual(['A'])
    expect(names({ anyOf: [{ $ref: '#/$defs/a' }, { $ref: '#/$defs/b' }] })).toEqual(['A', 'B'])
    expect(names({ if: { type: 'string' }, then: { $ref: '#/$defs/a' }, else: { $ref: '#/$defs/b' } })).toEqual([
      'A',
      'B',
    ])
    // A branch whose keywords merely happen to emit nothing is NOT treated as
    // always-matching: over-collecting costs an unused import, under-collecting
    // costs a name nothing defines.
    expect(names({ anyOf: [{ $ref: '#/$defs/a' }, { minContains: 2 }] })).toEqual(['A'])
  })
})
