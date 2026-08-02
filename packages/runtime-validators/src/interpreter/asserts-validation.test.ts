import { describe, expect, it } from 'vitest'

import { assertsValidation } from './asserts-validation'
import { buildSchemaRegistry } from './schema-registry'

/** Builds the registry `assertsValidation` reads, the way `prepare` does. */
const registryFor = (schema: unknown, documents?: Record<string, unknown>) => buildSchemaRegistry(schema, documents)

describe('asserts-validation', () => {
  it('says yes when there is no registry to consult', () => {
    expect(assertsValidation({ $schema: 'https://example.com/meta.json' }, null)).toBe(true)
  })

  it('says yes when the metaschema named by $schema was not registered', () => {
    // The strict answer is the safe one: an unreadable dialect never quietly
    // switches assertions off.
    const schema = { $schema: 'https://example.com/absent.json', minimum: 1 }
    expect(assertsValidation(schema, registryFor(schema, { 'https://example.com/other.json': {} }))).toBe(true)
  })

  it('says no when a registered metaschema leaves the validation vocabulary out', () => {
    const schema = { $schema: 'https://example.com/meta.json' }
    const documents = {
      'https://example.com/meta.json': {
        $vocabulary: { 'https://json-schema.org/draft/2020-12/vocab/core': true },
      },
    }

    expect(assertsValidation(schema, registryFor(schema, documents))).toBe(false)
  })

  it('says yes for a vocabulary listed as optional', () => {
    // `false` means "you may ignore this one", not "it is not in the dialect" —
    // presence in `$vocabulary` is what puts a vocabulary in force.
    const schema = { $schema: 'https://example.com/meta.json' }
    const documents = {
      'https://example.com/meta.json': {
        $vocabulary: { 'https://json-schema.org/draft/2020-12/vocab/validation': false },
      },
    }

    expect(assertsValidation(schema, registryFor(schema, documents))).toBe(true)
  })

  it('says yes for a metaschema that declares no $vocabulary at all', () => {
    const schema = { $schema: 'https://example.com/meta.json' }
    const documents = { 'https://example.com/meta.json': { type: 'object' } }

    expect(assertsValidation(schema, registryFor(schema, documents))).toBe(true)
  })

  it('says yes for a schema that is not an object, or names no dialect', () => {
    expect(assertsValidation(true, registryFor({ $id: 'https://example.com/root' }))).toBe(true)
    expect(assertsValidation({ type: 'string' }, registryFor({ $id: 'https://example.com/root' }))).toBe(true)
  })
})
