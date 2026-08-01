import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createOutputWriter } from './create-output-writer'
import { emitExamples } from './emit-examples'

const USER_SCHEMA: JSONSchema = {
  title: 'User',
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    age: { type: 'integer', minimum: 0 },
    address: { $ref: '#/$defs/address' },
  },
  required: ['id'],
  $defs: {
    address: { type: 'object', properties: { city: { type: 'string' } } },
  },
}

describe('emitExamples', () => {
  let outDir: string

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'mjst-examples-'))
  })

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true })
  })

  /** Emits into `outDir` through a writer and commits, the way the CLI does. */
  const emitAndCommit = async (options: Omit<Parameters<typeof emitExamples>[0], 'writer'>, force = false) => {
    const writer = await createOutputWriter(outDir, force)
    const staged = await emitExamples({ ...options, writer })
    await writer.commit()
    return staged
  }

  it('writes example files into an examples/ subdirectory so they never collide with parser output', async () => {
    const written = await emitAndCommit({ schema: USER_SCHEMA, rootTypeName: 'User' })

    // Every written path is reported relative to the writer root and rooted at examples/.
    expect(written).toEqual(
      expect.arrayContaining([
        join('examples', 'user.ts'),
        join('examples', 'address.ts'),
        join('examples', 'index.ts'),
      ]),
    )
    for (const path of written) expect(path.startsWith('examples')).toBe(true)

    // Only the examples tree and the writer's own manifest exist at the root, so
    // parser output (user.ts / index.ts) is safe.
    const rootEntries = await readdir(outDir)
    expect(rootEntries.filter((entry) => !entry.startsWith('.'))).toEqual(['examples'])
  })

  it('emits an arbitrary and a concrete example value per schema, plus a barrel', async () => {
    await emitAndCommit({ schema: USER_SCHEMA, rootTypeName: 'User' })

    const user = await readFile(join(outDir, 'examples', 'user.ts'), 'utf-8')
    expect(user).toContain("import * as fc from 'fast-check'")
    expect(user).toContain('export const UserArbitrary')
    expect(user).toContain('export const userExample')

    const barrel = await readFile(join(outDir, 'examples', 'index.ts'), 'utf-8')
    expect(barrel).toContain('user')
    expect(barrel).toContain('address')
  })

  it('mirrors a schema-dir subpath beneath examples/', async () => {
    const written = await emitAndCommit({
      schema: { title: 'Order', type: 'object', properties: { total: { type: 'number' } } },
      rootTypeName: 'Order',
      subDir: join('api', 'order'),
    })

    expect(written).toContain(join('examples', 'api', 'order', 'order.ts'))
    const order = await readFile(join(outDir, 'examples', 'api', 'order', 'order.ts'), 'utf-8')
    expect(order).toContain('export const OrderArbitrary')
  })

  it('prepends the banner prefix to every emitted file', async () => {
    const bannerPrefix = '/**\n * Auto-generated.\n */\n\n'
    await emitAndCommit({ schema: USER_SCHEMA, rootTypeName: 'User', bannerPrefix })

    for (const filename of ['user.ts', 'address.ts', 'index.ts']) {
      const content = await readFile(join(outDir, 'examples', filename), 'utf-8')
      expect(content.startsWith(bannerPrefix)).toBe(true)
    }
  })

  it('applies the type suffix to $ref-derived names in both the type and its arbitrary import', async () => {
    await emitAndCommit({ schema: USER_SCHEMA, rootTypeName: 'User', typeSuffix: 'Model' })

    const user = await readFile(join(outDir, 'examples', 'user.ts'), 'utf-8')
    // The $ref-derived Address becomes AddressModel; the root name is used verbatim.
    expect(user).toContain('AddressModel')
    expect(user).toContain('export type User =')
  })

  // Examples used to be written with a bare mkdir + writeFile, which made
  // `examples/index.ts` the one generated name that could still eat a
  // hand-written file — the exact clobber the writer exists to prevent, one
  // directory over from the parsers it protects.
  it('refuses to overwrite a hand-written file in examples/, leaving it intact', async () => {
    await mkdir(join(outDir, 'examples'), { recursive: true })
    await writeFile(join(outDir, 'examples', 'index.ts'), 'export const IMPORTANT = 42')

    const writer = await createOutputWriter(outDir)
    await expect(emitExamples({ schema: USER_SCHEMA, rootTypeName: 'User', writer })).rejects.toThrow(
      /Refusing to overwrite/,
    )
    await writer.discard()

    expect(await readFile(join(outDir, 'examples', 'index.ts'), 'utf-8')).toBe('export const IMPORTANT = 42')
    // Staging is all-or-nothing, so the files emitted before the collision did
    // not land either.
    expect(await readdir(join(outDir, 'examples'))).toEqual(['index.ts'])
  })

  it('overwrites a hand-written file in examples/ when --force was passed', async () => {
    await mkdir(join(outDir, 'examples'), { recursive: true })
    await writeFile(join(outDir, 'examples', 'index.ts'), 'export const IMPORTANT = 42')

    await emitAndCommit({ schema: USER_SCHEMA, rootTypeName: 'User' }, true)

    expect(await readFile(join(outDir, 'examples', 'index.ts'), 'utf-8')).not.toContain('IMPORTANT')
  })

  // Regenerating is the normal workflow: the manifest the first run leaves behind
  // is what lets the second one reclaim its own example files without --force.
  it('replaces example files a previous run generated', async () => {
    await emitAndCommit({ schema: USER_SCHEMA, rootTypeName: 'User' })

    await expect(emitAndCommit({ schema: USER_SCHEMA, rootTypeName: 'User' })).resolves.toContain(
      join('examples', 'index.ts'),
    )
  })
})
