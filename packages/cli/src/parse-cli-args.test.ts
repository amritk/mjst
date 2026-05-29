import { describe, expect, it } from 'vitest'

import { parseCliArgs } from './parse-cli-args'

describe('parse-cli-args', () => {
  it('parses --schema and --outDir with space-separated values', () => {
    const result = parseCliArgs(['--schema', 'path/to/schema.json', '--outDir', 'dist'])

    expect(result).toEqual({
      schema: 'path/to/schema.json',
      outDir: 'dist',
    })
  })

  it('parses --schema and --outDir with equals syntax', () => {
    const result = parseCliArgs(['--schema=path/to/schema.json', '--outDir=dist'])

    expect(result).toEqual({
      schema: 'path/to/schema.json',
      outDir: 'dist',
    })
  })

  it('returns empty object when no flags are provided', () => {
    const result = parseCliArgs([])

    expect(result).toEqual({})
  })

  it('ignores unknown flags', () => {
    const result = parseCliArgs(['--unknown', 'value', '--schema', 'schema.json'])

    expect(result).toEqual({
      schema: 'schema.json',
    })
  })

  it('handles only --schema without --outDir', () => {
    const result = parseCliArgs(['--schema', 'schema.json'])

    expect(result).toEqual({
      schema: 'schema.json',
    })
  })

  it('parses --schemaDir with space-separated and equals syntax', () => {
    expect(parseCliArgs(['--schemaDir', './schemas', '--outDir', 'dist'])).toEqual({
      schemaDir: './schemas',
      outDir: 'dist',
    })
    expect(parseCliArgs(['--schemaDir=./schemas', '--outDir=dist'])).toEqual({
      schemaDir: './schemas',
      outDir: 'dist',
    })
  })

  it('keeps --schema and --schemaDir distinct', () => {
    const result = parseCliArgs(['--schema', 'a.json', '--schemaDir', './schemas'])

    expect(result).toEqual({
      schema: 'a.json',
      schemaDir: './schemas',
    })
  })

  it('handles only --outDir without --schema', () => {
    const result = parseCliArgs(['--outDir', 'output'])

    expect(result).toEqual({
      outDir: 'output',
    })
  })

  it('does not treat a flag as a value for the previous flag', () => {
    const result = parseCliArgs(['--schema', '--outDir', 'output'])

    expect(result).toEqual({
      outDir: 'output',
    })
  })

  it('handles equals syntax with empty value', () => {
    const result = parseCliArgs(['--schema=', '--outDir=dist'])

    expect(result).toEqual({
      schema: '',
      outDir: 'dist',
    })
  })

  it('parses --types-only boolean flag', () => {
    const result = parseCliArgs(['--types-only'])

    expect(result).toEqual({
      typesOnly: true,
    })
  })

  it('parses --types-only=true with equals syntax', () => {
    const result = parseCliArgs(['--types-only=true'])

    expect(result).toEqual({
      typesOnly: true,
    })
  })

  it('parses --types-only=false with equals syntax', () => {
    const result = parseCliArgs(['--types-only=false'])

    expect(result).toEqual({
      typesOnly: false,
    })
  })

  it('parses --types-only alongside other flags', () => {
    const result = parseCliArgs(['--schema', 'schema.json', '--outDir', 'dist', '--types-only'])

    expect(result).toEqual({
      schema: 'schema.json',
      outDir: 'dist',
      typesOnly: true,
    })
  })

  it('parses --build boolean flag', () => {
    const result = parseCliArgs(['--build'])

    expect(result).toEqual({
      build: true,
    })
  })

  it('parses --build=true with equals syntax', () => {
    const result = parseCliArgs(['--build=true'])

    expect(result).toEqual({
      build: true,
    })
  })

  it('parses --build=false with equals syntax', () => {
    const result = parseCliArgs(['--build=false'])

    expect(result).toEqual({
      build: false,
    })
  })

  it('parses --build alongside other flags', () => {
    const result = parseCliArgs(['--schema', 'schema.json', '--outDir', 'dist', '--build'])

    expect(result).toEqual({
      schema: 'schema.json',
      outDir: 'dist',
      build: true,
    })
  })

  it('parses --log-warnings boolean flag', () => {
    const result = parseCliArgs(['--log-warnings'])

    expect(result).toEqual({
      logWarnings: true,
    })
  })

  it('parses --log-warnings=true with equals syntax', () => {
    const result = parseCliArgs(['--log-warnings=true'])

    expect(result).toEqual({
      logWarnings: true,
    })
  })

  it('parses --log-warnings=false with equals syntax', () => {
    const result = parseCliArgs(['--log-warnings=false'])

    expect(result).toEqual({
      logWarnings: false,
    })
  })

  it('parses --log-warnings alongside other flags', () => {
    const result = parseCliArgs(['--schema', 'schema.json', '--outDir', 'dist', '--log-warnings'])

    expect(result).toEqual({
      schema: 'schema.json',
      outDir: 'dist',
      logWarnings: true,
    })
  })

  it('parses --strict boolean flag', () => {
    const result = parseCliArgs(['--strict'])

    expect(result).toEqual({
      strict: true,
    })
  })

  it('parses --strict=true with equals syntax', () => {
    const result = parseCliArgs(['--strict=true'])

    expect(result).toEqual({
      strict: true,
    })
  })

  it('parses --strict=false with equals syntax', () => {
    const result = parseCliArgs(['--strict=false'])

    expect(result).toEqual({
      strict: false,
    })
  })

  it('parses --strict alongside other flags', () => {
    const result = parseCliArgs(['--schema', 'schema.json', '--outDir', 'dist', '--strict'])

    expect(result).toEqual({
      schema: 'schema.json',
      outDir: 'dist',
      strict: true,
    })
  })

  it('parses --helpers package with space-separated value', () => {
    const result = parseCliArgs(['--helpers', 'package'])
    expect(result).toEqual({ helpers: 'package' })
  })

  it('parses --helpers=embedded with equals syntax', () => {
    const result = parseCliArgs(['--helpers=embedded'])
    expect(result).toEqual({ helpers: 'embedded' })
  })

  it('ignores invalid --helpers values', () => {
    const result = parseCliArgs(['--helpers', 'bogus', '--schema', 's.json'])
    expect(result).toEqual({ schema: 's.json' })
  })

  it('ignores invalid --helpers=foo values', () => {
    const result = parseCliArgs(['--helpers=foo', '--schema', 's.json'])
    expect(result).toEqual({ schema: 's.json' })
  })

  it('accepts kebab-case flag names', () => {
    const result = parseCliArgs(['--schema-dir', './schemas', '--out-dir', 'dist'])

    expect(result).toEqual({
      schemaDir: './schemas',
      outDir: 'dist',
    })
  })

  it('treats kebab-case and camelCase variants as equivalent', () => {
    const kebab = parseCliArgs(['--out-dir', 'dist', '--types-only', '--log-warnings'])
    const camel = parseCliArgs(['--outDir', 'dist', '--typesOnly', '--logWarnings'])

    expect(kebab).toEqual(camel)
    expect(camel).toEqual({ outDir: 'dist', typesOnly: true, logWarnings: true })
  })

  it('parses --out-file with space-separated and equals syntax', () => {
    expect(parseCliArgs(['--out-file', './out/schema.ts'])).toEqual({ outFile: './out/schema.ts' })
    expect(parseCliArgs(['--outFile=./out/schema.ts'])).toEqual({ outFile: './out/schema.ts' })
  })

  it('parses --readonly boolean flag and its equals forms', () => {
    expect(parseCliArgs(['--readonly'])).toEqual({ readonly: true })
    expect(parseCliArgs(['--readonly=true'])).toEqual({ readonly: true })
    expect(parseCliArgs(['--readonly=false'])).toEqual({ readonly: false })
  })

  it('parses --banner boolean flag and its equals forms', () => {
    expect(parseCliArgs(['--banner'])).toEqual({ banner: true })
    expect(parseCliArgs(['--banner=true'])).toEqual({ banner: true })
    expect(parseCliArgs(['--banner=false'])).toEqual({ banner: false })
  })
})
