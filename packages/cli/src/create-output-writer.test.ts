import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createOutputWriter } from './create-output-writer'

describe('create-output-writer', () => {
  let outDir: string

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'mjst-writer-'))
  })

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true })
  })

  it('writes nothing until commit, then lands every staged file', async () => {
    const writer = await createOutputWriter(outDir)

    await writer.stage('obj.ts', 'export type Obj = { a: string }')
    await writer.stage(join('nested', 'index.ts'), 'export * from "./obj"')

    // Staged bytes live under temporary names, so the final paths are still free.
    expect(await readdir(outDir)).not.toContain('obj.ts')

    const committed = await writer.commit()

    expect(committed).toEqual(['obj.ts', join('nested', 'index.ts')])
    expect(await readFile(join(outDir, 'obj.ts'), 'utf-8')).toContain('export type Obj')
    expect(await readFile(join(outDir, 'nested', 'index.ts'), 'utf-8')).toContain('export *')
  })

  // The reason the writer exists: a generation that dies half-way used to leave a
  // tree with some files from this run and some from the last one.
  it('leaves the output directory untouched when staging fails part-way', async () => {
    // A regular file where a directory needs to go is exactly how the real failure
    // reproduced: the generator emits `_helpers/is-object.ts` into it.
    await writeFile(join(outDir, '_helpers'), '')

    const writer = await createOutputWriter(outDir)
    await writer.stage('obj.ts', 'export type Obj = never')
    await expect(writer.stage(join('_helpers', 'is-object.ts'), 'export const isObject = () => true')).rejects.toThrow()
    await writer.discard()

    // No obj.ts, and no `.tmp` leftovers either.
    expect(await readdir(outDir)).toEqual(['_helpers'])
  })

  // Ownership tracking is gone on purpose: an output directory is generated
  // output, and git is where an unwanted replacement shows up and gets reverted.
  it('replaces a pre-existing file at a generated path', async () => {
    await writeFile(join(outDir, 'index.ts'), 'export const IMPORTANT = 42')

    const writer = await createOutputWriter(outDir)
    await writer.stage('index.ts', 'export * from "./obj"')
    await writer.commit()

    expect(await readFile(join(outDir, 'index.ts'), 'utf-8')).toBe('export * from "./obj"')
  })

  // Filenames come from schema-supplied names, so a `../..` in one of them must
  // not be able to write outside the directory the user pointed at.
  it('refuses a path that escapes the output directory', async () => {
    const writer = await createOutputWriter(join(outDir, 'out'))

    await expect(writer.stage(join('..', '..', 'escaped.ts'), 'export type X = never')).rejects.toThrow(
      /resolves outside the output directory/,
    )
    await expect(writer.stage('/etc/mjst-absolute.ts', 'export type X = never')).rejects.toThrow(
      /resolves outside the output directory/,
    )
  })

  // Regenerating into the same directory is the normal workflow, so a rerun has
  // to land cleanly over its own output.
  it('replaces its own output on a rerun', async () => {
    const first = await createOutputWriter(outDir)
    await first.stage('obj.ts', 'export type Obj = { a: string }')
    await first.commit()

    const second = await createOutputWriter(outDir)
    await second.stage('obj.ts', 'export type Obj = { a: number }')
    await second.commit()

    expect(await readFile(join(outDir, 'obj.ts'), 'utf-8')).toContain('a: number')
    // Nothing bookkeeping-shaped is left beside the output.
    expect(await readdir(outDir)).toEqual(['obj.ts'])
  })

  it('allows nested paths that stay inside the output directory', async () => {
    await mkdir(join(outDir, 'existing'), { recursive: true })
    const writer = await createOutputWriter(outDir)

    await writer.stage(join('validators', 'api', 'order.ts'), 'export const validateOrder = () => true')

    expect(await writer.commit()).toEqual([join('validators', 'api', 'order.ts')])
  })
})
