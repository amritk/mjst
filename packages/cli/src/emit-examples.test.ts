import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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

  it('writes example files into an examples/ subdirectory so they never collide with parser output', async () => {
    const written = await emitExamples({ schema: USER_SCHEMA, rootTypeName: 'User', outputDir: outDir })

    // Every written path is reported relative to outDir and rooted at examples/.
    expect(written).toEqual(
      expect.arrayContaining([
        join('examples', 'user.ts'),
        join('examples', 'address.ts'),
        join('examples', 'index.ts'),
      ]),
    )
    for (const path of written) expect(path.startsWith('examples')).toBe(true)

    // Nothing was written at the root, so parser output (user.ts / index.ts) is safe.
    const rootEntries = await readdir(outDir)
    expect(rootEntries).toEqual(['examples'])
  })

  it('emits an arbitrary and a concrete example value per schema, plus a barrel', async () => {
    await emitExamples({ schema: USER_SCHEMA, rootTypeName: 'User', outputDir: outDir })

    const user = await readFile(join(outDir, 'examples', 'user.ts'), 'utf-8')
    expect(user).toContain("import * as fc from 'fast-check'")
    expect(user).toContain('export const UserArbitrary')
    expect(user).toContain('export const userExample')

    const barrel = await readFile(join(outDir, 'examples', 'index.ts'), 'utf-8')
    expect(barrel).toContain('user')
    expect(barrel).toContain('address')
  })

  it('mirrors a schema-dir subpath beneath examples/', async () => {
    const written = await emitExamples({
      schema: { title: 'Order', type: 'object', properties: { total: { type: 'number' } } },
      rootTypeName: 'Order',
      outputDir: outDir,
      subDir: join('api', 'order'),
    })

    expect(written).toContain(join('examples', 'api', 'order', 'order.ts'))
    const order = await readFile(join(outDir, 'examples', 'api', 'order', 'order.ts'), 'utf-8')
    expect(order).toContain('export const OrderArbitrary')
  })

  it('prepends the banner prefix to every emitted file', async () => {
    const bannerPrefix = '/**\n * Auto-generated.\n */\n\n'
    await emitExamples({ schema: USER_SCHEMA, rootTypeName: 'User', outputDir: outDir, bannerPrefix })

    for (const filename of ['user.ts', 'address.ts', 'index.ts']) {
      const content = await readFile(join(outDir, 'examples', filename), 'utf-8')
      expect(content.startsWith(bannerPrefix)).toBe(true)
    }
  })

  it('applies the type suffix to $ref-derived names in both the type and its arbitrary import', async () => {
    await emitExamples({ schema: USER_SCHEMA, rootTypeName: 'User', outputDir: outDir, typeSuffix: 'Model' })

    const user = await readFile(join(outDir, 'examples', 'user.ts'), 'utf-8')
    // The $ref-derived Address becomes AddressModel; the root name is used verbatim.
    expect(user).toContain('AddressModel')
    expect(user).toContain('export type User =')
  })
})
