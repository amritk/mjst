import { describe, expect, it } from 'vitest'

import { buildExampleSchema, type GeneratedFile } from './build-schema'

/** Returns the content of a generated file, failing the test if it is absent. */
const contentOf = (files: GeneratedFile[], filename: string): string => {
  const file = files.find((f) => f.filename === filename)
  if (!file) throw new Error(`expected a generated file named ${filename}`)
  return file.content
}

describe('buildExampleSchema', () => {
  it('emits a file per schema and an index barrel', async () => {
    const schema = {
      type: 'object' as const,
      properties: { name: { type: 'string' as const } },
      required: ['name'],
    }
    const files = await buildExampleSchema(schema, 'User')
    const names = files.map((f) => f.filename)

    expect(names).toContain('user.ts')
    expect(names).toContain('index.ts')

    const user = contentOf(files, 'user.ts')
    expect(user).toContain("import * as fc from 'fast-check'")
    expect(user).toContain('export type User =')
    expect(user).toContain('export const UserArbitrary: fc.Arbitrary<User> =')
    expect(user).toContain('export const userExample: User =')
  })

  it('follows $refs into their own files and imports their arbitraries', async () => {
    const schema = {
      type: 'object' as const,
      properties: { address: { $ref: '#/$defs/address' } },
      required: ['address'],
      $defs: {
        address: {
          type: 'object' as const,
          properties: { city: { type: 'string' as const } },
          required: ['city'],
        },
      },
    }
    const files = await buildExampleSchema(schema, 'User')
    const names = files.map((f) => f.filename)

    expect(names).toContain('address.ts')

    const user = contentOf(files, 'user.ts')
    expect(user).toContain("import { type Address, AddressArbitrary } from './address.js'")
    expect(user).toContain('"address": AddressArbitrary')

    // The concrete example inlines the ref's value rather than referencing a const.
    expect(user).toContain('"address": { "city": "string" }')
  })

  it('re-exports types, arbitraries and examples from the index barrel', async () => {
    const schema = { type: 'object' as const, properties: { id: { type: 'string' as const } } }
    const files = await buildExampleSchema(schema, 'Thing')
    const index = contentOf(files, 'index.ts')

    expect(index).toContain("export { type Thing, ThingArbitrary, thingExample } from './thing.js';")
  })
})
