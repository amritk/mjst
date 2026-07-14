import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadSchema } from './load-schema'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'mjst-load-schema-'))

/** Writes `content` (JSON-stringified) to `name` under a fresh temp dir; returns the file path. */
const write = (dir: string, name: string, content: unknown): string => {
  const file = join(dir, name)
  writeFileSync(file, JSON.stringify(content))
  return file
}

describe('loadSchema', () => {
  it('parses a plain JSON schema as-is', async () => {
    const dir = tmp()
    const file = write(dir, 'schema.json', { type: 'object', properties: { name: { type: 'string' } } })

    const schema = (await loadSchema({}, file)) as Record<string, unknown>
    expect(schema).toEqual({ type: 'object', properties: { name: { type: 'string' } } })
  })

  it('leaves same-document $refs intact so the generator produces named types', async () => {
    const dir = tmp()
    // A schema whose only reference is an internal `#/$defs` pointer must NOT be
    // inlined — the generator resolves those itself into separate type files.
    const file = write(dir, 'schema.json', {
      type: 'object',
      properties: { contact: { $ref: '#/$defs/contact' } },
      $defs: { contact: { type: 'object', properties: { email: { type: 'string' } } } },
    })

    const schema = (await loadSchema({}, file)) as { properties: { contact: unknown } }
    expect(schema.properties.contact).toEqual({ $ref: '#/$defs/contact' })
  })

  it('inlines a cross-file $ref into a single document', async () => {
    const dir = tmp()
    write(dir, 'user.json', { type: 'object', properties: { name: { type: 'string' } } })
    const main = write(dir, 'order.json', {
      type: 'object',
      properties: { user: { $ref: './user.json' } },
    })

    const schema = (await loadSchema({}, main)) as {
      properties: { user: { type: string; properties: { name: { type: string } } } }
    }
    // The referenced document is inlined in place of the `$ref`.
    expect(schema.properties.user).toEqual({ type: 'object', properties: { name: { type: 'string' } } })
  })

  it('resolves a pointer into another file', async () => {
    const dir = tmp()
    write(dir, 'common.json', { $defs: { id: { type: 'string', pattern: '^[0-9]+$' } } })
    const main = write(dir, 'order.json', {
      type: 'object',
      properties: { id: { $ref: './common.json#/$defs/id' } },
    })

    const schema = (await loadSchema({}, main)) as { properties: { id: unknown } }
    expect(schema.properties.id).toEqual({ type: 'string', pattern: '^[0-9]+$' })
  })

  it('surfaces a missing cross-file target as a CLI error', async () => {
    const dir = tmp()
    const main = write(dir, 'order.json', {
      type: 'object',
      properties: { user: { $ref: './does-not-exist.json' } },
    })

    await expect(loadSchema({}, main)).rejects.toThrow(/Failed to resolve \$refs/)
  })

  it('refuses a remote $ref by default (offline, no network call)', async () => {
    const dir = tmp()
    const main = write(dir, 'order.json', {
      type: 'object',
      properties: { user: { $ref: 'https://example.test/user.json' } },
    })

    // With remote resolution off (the default), the http $ref is refused rather
    // than fetched, so the run fails with a clear reason and makes no request.
    await expect(loadSchema({}, main)).rejects.toThrow(/remote \$ref resolution is disabled/)
  })
})
