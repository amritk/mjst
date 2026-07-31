import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { CONFIG_KEYS, validateConfig } from './validate-config'

/** The shipped config schema, the source of truth `CONFIG_KEYS` mirrors. */
const readConfigSchema = async (): Promise<{
  properties: Record<string, { type: string | string[]; items?: { type: string }; enum?: string[] }>
  additionalProperties?: boolean
}> => JSON.parse(await readFile(new URL('../config.schema.json', import.meta.url), 'utf-8'))

/** Renders a schema property's type the way `validate-config` names it. */
const typeLabel = (property: { type: string | string[]; items?: { type: string } }): string => {
  if (Array.isArray(property.type)) return property.type.join('|')
  if (property.type === 'array') return `${property.items?.type}[]`
  return property.type
}

describe('validate-config', () => {
  it('accepts a config that uses every kind of value', () => {
    expect(() =>
      validateConfig(
        {
          schema: './schema.json',
          outDir: './generated',
          strict: true,
          banner: 'Generated',
          helpers: 'embedded',
          allowedHosts: ['a.com', 'b.com'],
        },
        'mjst.config.json',
      ),
    ).not.toThrow()
  })

  it('reports an unknown key with its pointer', () => {
    expect(() => validateConfig({ strcit: true }, 'mjst.config.json')).toThrow(/\/strcit: unknown option/)
  })

  it('reports a wrong type with the expected and received type', () => {
    expect(() => validateConfig({ strict: 'true' }, 'mjst.config.json')).toThrow(
      '/strict: expected boolean, received string.',
    )
    expect(() => validateConfig({ validators: 1 }, 'mjst.config.json')).toThrow(
      '/validators: expected boolean, received number.',
    )
    expect(() => validateConfig({ allowedHosts: 'a.com' }, 'mjst.config.json')).toThrow(
      '/allowedHosts: expected string[], received string.',
    )
  })

  it('reports a value outside a closed enum', () => {
    expect(() => validateConfig({ input: 'protobuf' }, 'mjst.config.json')).toThrow(
      '/input: expected one of json, typebox, zod, valibot, effect, received "protobuf".',
    )
  })

  // One bad key should not hide the next: a user fixing a config wants the whole
  // list, not one problem per run.
  it('collects every problem in a single error', () => {
    expect(() => validateConfig({ strcit: true, strict: 'true', readonly: 'yes' }, 'mjst.config.json')).toThrow(
      /strcit[\s\S]*strict[\s\S]*readonly/,
    )
  })

  it('accepts banner as either a boolean or a string', () => {
    expect(() => validateConfig({ banner: true }, 'c.json')).not.toThrow()
    expect(() => validateConfig({ banner: 'Custom header' }, 'c.json')).not.toThrow()
    expect(() => validateConfig({ banner: 42 }, 'c.json')).toThrow('/banner: expected boolean|string, received number.')
  })

  // The key table is hand-maintained because config.schema.json is not shipped in
  // the published package. This is the guard that keeps the two in lockstep: a new
  // option in the schema has to appear here (and vice versa) or config files
  // silently reject — or accept — the wrong thing.
  it('covers exactly the keys declared in config.schema.json, with matching types', async () => {
    const schema = await readConfigSchema()

    expect(Object.keys(CONFIG_KEYS).sort()).toEqual(Object.keys(schema.properties).sort())

    for (const [key, property] of Object.entries(schema.properties)) {
      const expected = typeLabel(property)
      const wrongType = expected === 'boolean' ? 'not-a-boolean' : 42

      // A key the table does not know is reported as unknown; a known key with the
      // wrong type is reported as a type mismatch. Either way the message names it.
      expect(() => validateConfig({ [key]: wrongType }, 'c.json')).toThrow(
        new RegExp(`/${key.replace(/\$/g, '\\$')}: expected ${expected.replace(/[[\]|]/g, '\\$&')},`),
      )

      if (property.enum) {
        expect(() => validateConfig({ [key]: '__not-in-enum__' }, 'c.json')).toThrow(
          `/${key}: expected one of ${property.enum.join(', ')}`,
        )
      }
    }
  })

  it('is backed by a schema that closes the object to unknown keys', async () => {
    // Editors validate mjst.config.json against the schema directly, so the
    // schema has to reject typos the same way this function does.
    expect((await readConfigSchema()).additionalProperties).toBe(false)
  })
})
