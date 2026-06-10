import { describe, expect, it } from 'vitest'

import { collectValidatorImports } from './collect-validator-imports'

describe('collect-validator-imports', () => {
  it('collects a direct property $ref', () => {
    const schema = { properties: { contact: { $ref: '#/$defs/contact' } } }

    expect(collectValidatorImports(schema)).toEqual(["import { type Contact, validateContact } from './contact'"])
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
      "import { type Address, validateAddress } from './address'",
      "import { type Contact, validateContact } from './contact'",
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

    expect(collectValidatorImports(schema)).toEqual(["import { type Contact, validateContact } from './contact'"])
  })
})
