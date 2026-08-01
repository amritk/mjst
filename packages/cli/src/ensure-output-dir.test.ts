import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ensureOutputDir } from './ensure-output-dir'

describe('ensure-output-dir', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'mjst-outdir-'))
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('creates the directory, including missing parents', async () => {
    await ensureOutputDir(join(base, 'a', 'b'))

    expect(await readdir(join(base, 'a'))).toEqual(['b'])
  })

  it('is a no-op when the directory already exists', async () => {
    await ensureOutputDir(join(base, 'a'))
    await expect(ensureOutputDir(join(base, 'a'))).resolves.toBeUndefined()
  })

  // The raw failure was `EEXIST: file already exists, mkdir '/abs/path'`, which
  // says nothing about --out-dir being pointed at a file.
  it('explains that the path is taken by a file', async () => {
    const file = join(base, 'not-a-dir')
    await writeFile(file, '')

    await expect(ensureOutputDir(file)).rejects.toThrow(`Cannot use ${file} as the output directory`)
  })

  it('explains it too when the file sits midway through the path', async () => {
    await writeFile(join(base, 'file'), '')

    await expect(ensureOutputDir(join(base, 'file', 'nested'))).rejects.toThrow('as the output directory')
  })
})
