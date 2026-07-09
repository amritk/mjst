import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadConfig } from './load-config'

describe('load-config', () => {
  it('loads schema and outDir from a JSON config file', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 'my-schema.json', outDir: 'output' }))

    const result = await loadConfig(configPath)

    expect(result).toEqual({
      schema: 'my-schema.json',
      outDir: 'output',
    })
  })

  it('returns partial config when only some keys are present', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 'my-schema.json' }))

    const result = await loadConfig(configPath)

    expect(result).toEqual({
      schema: 'my-schema.json',
    })
  })

  it('ignores non-string values for known keys', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 123, outDir: true }))

    const result = await loadConfig(configPath)

    expect(result).toEqual({})
  })

  it('throws for non-object config files', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify([1, 2, 3]))

    await expect(loadConfig(configPath)).rejects.toThrow('Config file must be a JSON object')
  })

  it('throws for missing config files', async () => {
    await expect(loadConfig('/nonexistent/config.json')).rejects.toThrow()
  })

  it('loads strict boolean from config file', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', outDir: 'o', strict: true }))

    const result = await loadConfig(configPath)

    expect(result).toEqual({ schema: 's.json', outDir: 'o', strict: true })
  })

  it('loads stripUnknown boolean from config file', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', outDir: 'o', stripUnknown: true }))

    const result = await loadConfig(configPath)

    expect(result).toEqual({ schema: 's.json', outDir: 'o', stripUnknown: true })
  })

  it('loads caseInsensitive boolean from config file', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', outDir: 'o', caseInsensitive: true }))

    const result = await loadConfig(configPath)

    expect(result).toEqual({ schema: 's.json', outDir: 'o', caseInsensitive: true })
  })

  it('ignores non-boolean caseInsensitive value', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', caseInsensitive: 'yes' }))

    const result = await loadConfig(configPath)

    expect(result).toEqual({ schema: 's.json' })
  })

  it('ignores non-boolean stripUnknown value', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', stripUnknown: 'yes' }))

    const result = await loadConfig(configPath)

    expect(result).toEqual({ schema: 's.json' })
  })

  it('loads schemaDir from a config file', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schemaDir: './schemas', outDir: 'output' }))

    const result = await loadConfig(configPath)

    expect(result).toEqual({ schemaDir: './schemas', outDir: 'output' })
  })

  it('ignores non-boolean strict value', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', strict: 'yes' }))

    const result = await loadConfig(configPath)

    expect(result).toEqual({ schema: 's.json' })
  })

  it('loads helpers, typeSuffix, and banner keys from a config file', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(
      configPath,
      JSON.stringify({ schema: 's.json', helpers: 'embedded', typeSuffix: 'Object', banner: 'Generated file' }),
    )

    const result = await loadConfig(configPath)

    expect(result).toEqual({ schema: 's.json', helpers: 'embedded', typeSuffix: 'Object', banner: 'Generated file' })
  })

  it('loads importExt and drops an invalid value', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}-ext.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', importExt: 'ts' }))
    expect(await loadConfig(configPath)).toEqual({ schema: 's.json', importExt: 'ts' })

    await writeFile(configPath, JSON.stringify({ schema: 's.json', importExt: 'mjs' }))
    expect(await loadConfig(configPath)).toEqual({ schema: 's.json' })
  })

  it('loads rootType from a config file and ignores a non-string value', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}-root.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', rootType: 'Program' }))
    expect(await loadConfig(configPath)).toEqual({ schema: 's.json', rootType: 'Program' })

    await writeFile(configPath, JSON.stringify({ schema: 's.json', rootType: 42 }))
    expect(await loadConfig(configPath)).toEqual({ schema: 's.json' })
  })

  it('loads a boolean banner and ignores an invalid helpers value', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ banner: true, helpers: 'bogus' }))

    const result = await loadConfig(configPath)

    // `banner: true` is kept; the unknown helpers mode is dropped rather than trusted.
    expect(result).toEqual({ banner: true })
  })
})
