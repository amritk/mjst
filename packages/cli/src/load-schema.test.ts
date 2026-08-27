import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadSchema } from './load-schema'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'mjst-load-schema-'))

/**
 * Builds the split-spec layout the confinement default trips over: a versioned
 * document referencing a shared schema in a sibling folder.
 *
 * ```
 * <root>/v1/api.json      → { "$ref": "../common/user.json" }
 * <root>/common/user.json
 * ```
 */
const splitSpec = (): { root: string; main: string } => {
  const root = tmp()
  mkdirSync(join(root, 'v1'))
  mkdirSync(join(root, 'common'))
  writeFileSync(join(root, 'common', 'user.json'), JSON.stringify({ type: 'object' }))
  const main = join(root, 'v1', 'api.json')
  writeFileSync(main, JSON.stringify({ type: 'object', properties: { user: { $ref: '../common/user.json' } } }))
  return { root, main }
}

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

  it('refuses a sibling-directory $ref without allowedRoots', async () => {
    const { main } = splitSpec()

    await expect(loadSchema({}, main)).rejects.toThrow(/Refusing to read local \$ref/)
  })

  // The whole point of the flag: the library message names a library option, which
  // is unreachable from a terminal, so the CLI has to name its own flag instead.
  it('names --allowed-roots in the refusal so the message is actionable', async () => {
    const { main } = splitSpec()

    await expect(loadSchema({}, main)).rejects.toThrow(/pass --allowed-roots <dir>/)
  })

  it('resolves a sibling-directory $ref once allowedRoots names the shared parent', async () => {
    const { root, main } = splitSpec()

    const schema = (await loadSchema({ allowedRoots: [root] }, main)) as { properties: { user: unknown } }
    expect(schema.properties.user).toEqual({ type: 'object' })
  })

  // `allowedRoots` replaces the resolver's default outright, so the CLI keeps the
  // schema's own directory in the list — naming a shared folder must not revoke
  // the one directory a user would never think to list.
  it('keeps the schema own directory allowed alongside the named roots', async () => {
    const { root, main } = splitSpec()
    writeFileSync(join(root, 'v1', 'local.json'), JSON.stringify({ type: 'string' }))
    writeFileSync(
      main,
      JSON.stringify({
        type: 'object',
        properties: { user: { $ref: '../common/user.json' }, id: { $ref: './local.json' } },
      }),
    )

    const schema = (await loadSchema({ allowedRoots: [join(root, 'common')] }, main)) as {
      properties: { user: unknown; id: unknown }
    }
    expect(schema.properties.user).toEqual({ type: 'object' })
    expect(schema.properties.id).toEqual({ type: 'string' })
  })

  // The flag widens confinement; it must not dissolve it. A `$ref` that climbs
  // out of every named root stays refused, which is what keeps `--allowed-roots`
  // from being a way back to reading arbitrary files.
  it('still refuses a $ref that traverses outside the named roots', async () => {
    const { root, main } = splitSpec()
    const outside = tmp()
    writeFileSync(join(outside, 'secret.json'), JSON.stringify({ type: 'string' }))
    const traversingRef = join('..', '..', basename(outside), 'secret.json')
    writeFileSync(main, JSON.stringify({ type: 'object', properties: { leaked: { $ref: traversingRef } } }))

    await expect(loadSchema({ allowedRoots: [root] }, main)).rejects.toThrow(/Refusing to read local \$ref/)
  })

  it('still refuses an absolute $ref outside the named roots', async () => {
    const { root, main } = splitSpec()
    writeFileSync(main, JSON.stringify({ type: 'object', properties: { leaked: { $ref: '/etc/hostname' } } }))

    await expect(loadSchema({ allowedRoots: [root] }, main)).rejects.toThrow(/Refusing to read local \$ref/)
  })

  // An Avro schema is a JSON document, not a module exporting a value, so it
  // takes the read-and-parse path rather than the `import()` one every other
  // non-JSON format uses.
  it('reads an avro schema off disk without importing it', async () => {
    const path = write(tmp(), 'user.avsc', {
      type: 'record',
      name: 'User',
      namespace: 'com.example',
      fields: [{ name: 'id', type: 'string' }],
    })

    const schema = (await loadSchema({ input: 'avro' }, path)) as {
      $ref: string
      $defs: Record<string, { properties: Record<string, unknown> }>
    }

    expect(schema.$ref).toBe('#/$defs/com.example.User')
    expect(schema.$defs['com.example.User']?.properties['id']).toEqual({ type: 'string' })
  })

  it('surfaces an invalid avro schema as an error', async () => {
    const path = write(tmp(), 'broken.avsc', { type: 'record', name: 'NoFields' })

    await expect(loadSchema({ input: 'avro' }, path)).rejects.toThrow(/missing its required "fields"/)
  })
})
