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
})
