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

  // A wrong type used to be dropped silently, so the run generated with the
  // defaults while the user believed the config had taken effect.
  it('rejects wrong value types and names every offending key', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 123, outDir: true }))

    await expect(loadConfig(configPath)).rejects.toThrow(
      /\/schema: expected string, received number[\s\S]*\/outDir: expected string, received boolean/,
    )
  })

  it('rejects an unknown key rather than ignoring the typo', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', outDir: 'o', strcit: true }))

    await expect(loadConfig(configPath)).rejects.toThrow(/\/strcit: unknown option/)
  })

  // Editors point at the config schema with `$schema`; it describes the file
  // rather than configuring a run, so it is not an unknown option.
  it('accepts the $schema metadata key', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ $schema: './config.schema.json', schema: 's.json', outDir: 'o' }))

    expect(await loadConfig(configPath)).toEqual({ schema: 's.json', outDir: 'o' })
  })

  it('throws for non-object config files', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify([1, 2, 3]))

    await expect(loadConfig(configPath)).rejects.toThrow('Config file must be a JSON object')
  })

  it('throws an actionable error for a missing config file', async () => {
    // Not the raw `ENOENT: no such file or directory, open …`, which reads like
    // an internal failure rather than "that path is not there".
    await expect(loadConfig('/nonexistent/config.json')).rejects.toThrow(
      'Config file not found: /nonexistent/config.json',
    )
  })

  it('loads strict boolean from config file', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', outDir: 'o', strict: true }))

    const result = await loadConfig(configPath)

    expect(result).toEqual({ schema: 's.json', outDir: 'o', strict: true })
  })

  it('loads validators boolean from config file', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', outDir: 'o', validators: true }))

    const result = await loadConfig(configPath)

    expect(result).toEqual({ schema: 's.json', outDir: 'o', validators: true })
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

  it('rejects a non-boolean caseInsensitive value', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', caseInsensitive: 'yes' }))

    await expect(loadConfig(configPath)).rejects.toThrow('/caseInsensitive: expected boolean, received string.')
  })

  it('rejects a non-boolean stripUnknown value', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', stripUnknown: 'yes' }))

    await expect(loadConfig(configPath)).rejects.toThrow('/stripUnknown: expected boolean, received string.')
  })

  it('loads the reference-resolution keys from a config file', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(
      configPath,
      JSON.stringify({
        schema: 's.json',
        outDir: 'o',
        resolveRemote: true,
        allowedHosts: ['a.com', 'b.com'],
        allowPrivateHosts: true,
      }),
    )

    const result = await loadConfig(configPath)

    expect(result).toEqual({
      schema: 's.json',
      outDir: 'o',
      resolveRemote: true,
      allowedHosts: ['a.com', 'b.com'],
      allowPrivateHosts: true,
    })
  })

  it('rejects an allowedHosts value that is not an array of strings', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', allowedHosts: ['ok', 42] }))

    await expect(loadConfig(configPath)).rejects.toThrow('/allowedHosts: expected string[], received array.')
  })

  // Entries are handed back verbatim: they are resolved against the process cwd
  // later, exactly like `schema` and `outDir`, rather than against this file.
  it('loads allowedRoots from a config file without rewriting the paths', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(
      configPath,
      JSON.stringify({ schema: 's.json', outDir: 'o', allowedRoots: ['./specs', '../shared'] }),
    )

    const result = await loadConfig(configPath)

    expect(result).toEqual({ schema: 's.json', outDir: 'o', allowedRoots: ['./specs', '../shared'] })
  })

  it('rejects an allowedRoots value that is not an array of strings', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', allowedRoots: './specs' }))

    await expect(loadConfig(configPath)).rejects.toThrow('/allowedRoots: expected string[], received string.')
  })

  it('loads examples boolean from config file', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', outDir: 'o', examples: true }))

    const result = await loadConfig(configPath)

    expect(result).toEqual({ schema: 's.json', outDir: 'o', examples: true })
  })

  it('rejects a non-boolean examples value', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', examples: 'yes' }))

    await expect(loadConfig(configPath)).rejects.toThrow('/examples: expected boolean, received string.')
  })

  it('loads schemaDir from a config file', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schemaDir: './schemas', outDir: 'output' }))

    const result = await loadConfig(configPath)

    expect(result).toEqual({ schemaDir: './schemas', outDir: 'output' })
  })

  it('rejects a non-boolean strict value', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', strict: 'yes' }))

    await expect(loadConfig(configPath)).rejects.toThrow('/strict: expected boolean, received string.')
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

  it('loads importExt and rejects a value outside the enum', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}-ext.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', importExt: 'ts' }))
    expect(await loadConfig(configPath)).toEqual({ schema: 's.json', importExt: 'ts' })

    await writeFile(configPath, JSON.stringify({ schema: 's.json', importExt: 'mjs' }))
    await expect(loadConfig(configPath)).rejects.toThrow('/importExt: expected one of js, ts, received "mjs".')
  })

  it('loads rootType from a config file and rejects a non-string value', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}-root.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', rootType: 'Program' }))
    expect(await loadConfig(configPath)).toEqual({ schema: 's.json', rootType: 'Program' })

    await writeFile(configPath, JSON.stringify({ schema: 's.json', rootType: 42 }))
    await expect(loadConfig(configPath)).rejects.toThrow('/rootType: expected string, received number.')
  })

  it('loads a boolean banner and rejects an invalid helpers value', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`)
    await writeFile(configPath, JSON.stringify({ banner: true }))
    expect(await loadConfig(configPath)).toEqual({ banner: true })

    await writeFile(configPath, JSON.stringify({ banner: true, helpers: 'bogus' }))
    await expect(loadConfig(configPath)).rejects.toThrow(
      '/helpers: expected one of package, embedded, received "bogus".',
    )
  })

  it('loads the force flag from a config file', async () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}-force.json`)
    await writeFile(configPath, JSON.stringify({ schema: 's.json', outDir: 'o', force: true }))

    expect(await loadConfig(configPath)).toEqual({ schema: 's.json', outDir: 'o', force: true })
  })
})
