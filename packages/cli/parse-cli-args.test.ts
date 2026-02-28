import { describe, expect, it } from 'bun:test'
import { parseCliArgs } from '#cli/parse-cli-args'

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
})
