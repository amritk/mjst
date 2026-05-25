import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadSchemaModule } from './load-schema-module'

describe('loadSchemaModule', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mjst-load-module-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const write = async (name: string, contents: string): Promise<string> => {
    const path = join(dir, name)
    await writeFile(path, contents, 'utf-8')
    return path
  }

  it('returns the default export when no export name is given', async () => {
    const path = await write('default.mjs', 'export default { type: "string" }')
    expect(await loadSchemaModule(path)).toEqual({ type: 'string' })
  })

  it('returns the sole named export when there is no default', async () => {
    const path = await write('single.mjs', 'export const Schema = { type: "number" }')
    expect(await loadSchemaModule(path)).toEqual({ type: 'number' })
  })

  it('returns the requested named export', async () => {
    const path = await write('named.mjs', 'export const A = { type: "boolean" }; export const B = { type: "string" }')
    expect(await loadSchemaModule(path, 'B')).toEqual({ type: 'string' })
  })

  it('throws when the requested export is missing', async () => {
    const path = await write('missing.mjs', 'export const A = { type: "boolean" }')
    await expect(loadSchemaModule(path, 'Nope')).rejects.toThrow(/no export named 'Nope'/)
  })

  it('throws when multiple exports are ambiguous', async () => {
    const path = await write('ambiguous.mjs', 'export const A = {}; export const B = {}')
    await expect(loadSchemaModule(path)).rejects.toThrow(/Specify which one to use with --export/)
  })
})
