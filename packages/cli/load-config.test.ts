import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'bun:test'
import { loadConfig } from '#cli/load-config'

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
})
