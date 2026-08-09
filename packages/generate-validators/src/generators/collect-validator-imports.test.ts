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

  // Which `$ref`s the import list has to carry is decided by what the emitted
  // *file* references — and that is the type as well as the validator. The type
  // generator folds nothing: it unions every `anyOf` branch and reads a tuple's
  // rest from `additionalItems` whenever `items` is an array. Trimming the list to
  // what the validator still calls stranded those type names (`TS2304`), which is
  // worse than the unused import it saved.
  it('keeps a $ref the type references even when the validator folds its branch', () => {
    const rootSchema = { $defs: { a: { type: 'string' }, b: { type: 'number' } } }
    const names = (schema: unknown): string[] =>
      collectValidatorImports(schema as never, { rootSchema }).map((line) => /validate(\w+)/.exec(line)?.[1] ?? line)

    // The emitter drops a vacuous `anyOf`; the type still says `A | unknown`.
    expect(names({ anyOf: [{ $ref: '#/$defs/a' }, true] })).toEqual(['A'])
    expect(names({ anyOf: [{ $ref: '#/$defs/a' }, { description: 'anything' }] })).toEqual(['A'])
    // The emitter takes one arm of a statically-known `if`; the arm it drops is
    // still collected, because which arm the type generator reads is not this
    // module's business to predict.
    expect(names({ if: false, then: { $ref: '#/$defs/a' }, else: { $ref: '#/$defs/b' } })).toEqual(['A', 'B'])
    // `prefixItems` wins the positions, so the validator ignores the array
    // `items` and its `additionalItems` tail — but the type reads that tail.
    expect(
      names({
        type: 'array',
        prefixItems: [{ type: 'string' }],
        items: [{ type: 'number' }],
        additionalItems: { $ref: '#/$defs/b' },
      }),
    ).toEqual(['B'])
  })

  it('still skips a $ref in a position neither emitter reads', () => {
    const rootSchema = { $defs: { a: { type: 'string' }, b: { type: 'number' } } }
    const names = (schema: unknown): string[] =>
      collectValidatorImports(schema as never, { rootSchema }).map((line) => /validate(\w+)/.exec(line)?.[1] ?? line)

    // `then` means nothing without an `if`, and `additionalItems` means nothing
    // without an array `items` — neither the validator nor the type reads them, so
    // collecting them refused schemas whose ref happened to be unresolvable.
    expect(names({ $ref: '#/$defs/a', then: { $ref: '#/$defs/b' } })).toEqual(['A'])
    expect(names({ type: 'array', items: { type: 'number' }, additionalItems: { $ref: '#/$defs/b' } })).toEqual([])
  })
})
