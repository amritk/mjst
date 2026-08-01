import { describe, expect, it } from 'vitest'

import { parseMetaRequest } from './parse-meta-request'

describe('parse-meta-request', () => {
  it('recognizes the version and help subcommands', () => {
    expect(parseMetaRequest(['version'])).toBe('version')
    expect(parseMetaRequest(['help'])).toBe('help')
  })

  it('recognizes the flags in either form', () => {
    expect(parseMetaRequest(['--version'])).toBe('version')
    expect(parseMetaRequest(['-v'])).toBe('version')
    expect(parseMetaRequest(['--help'])).toBe('help')
    expect(parseMetaRequest(['-h'])).toBe('help')
  })

  // The bug this guards: `--type-suffix -v` printed the version and exited 0
  // without generating anything, which CI happily reads as a green build.
  it('treats a token in a flag value position as that flag value', () => {
    expect(parseMetaRequest(['--schema', 's.json', '--out-dir', 'dist', '--type-suffix', '-v'])).toBeUndefined()
    expect(parseMetaRequest(['--banner', '-h'])).toBeUndefined()
    expect(parseMetaRequest(['--allowed-hosts', '-v'])).toBeUndefined()
    expect(parseMetaRequest(['--config', '-h'])).toBeUndefined()
  })

  it('still honors the flag after a value-taking flag has been satisfied', () => {
    expect(parseMetaRequest(['--type-suffix', 'Object', '--version'])).toBe('version')
    // `--flag=value` carries its own value, so it never swallows the next token.
    expect(parseMetaRequest(['--type-suffix=Object', '--help'])).toBe('help')
  })

  it('ignores boolean flags when deciding what is a value', () => {
    expect(parseMetaRequest(['--strict', '-v'])).toBe('version')
  })

  it('returns undefined for a normal generation run', () => {
    expect(parseMetaRequest(['--schema', 's.json', '--out-dir', 'dist'])).toBeUndefined()
    expect(parseMetaRequest([])).toBeUndefined()
  })
})
