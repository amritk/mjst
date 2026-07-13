import { describe, expect, it } from 'vitest'

import { HELP_TEXT } from './help-text'

describe('help-text', () => {
  // The help is a hand-written constant, so this list is the guard that a new
  // flag cannot ship without appearing in `mjst --help`.
  it('lists every supported flag', () => {
    const flags = [
      '--schema',
      '--schema-dir',
      '--input',
      '--export',
      '--out-dir',
      '--out-file',
      '--types-only',
      '--build',
      '--import-ext',
      '--helpers',
      '--root-type',
      '--type-suffix',
      '--banner',
      '--readonly',
      '--strict',
      '--strip-unknown',
      '--case-insensitive',
      '--log-warnings',
      '--resolve-remote',
      '--allowed-hosts',
      '--allow-private-hosts',
      '--config',
      '--version',
      '--help',
    ]
    for (const flag of flags) {
      expect(HELP_TEXT).toContain(flag)
    }
  })

  it('starts with a usage synopsis', () => {
    expect(HELP_TEXT).toContain('Usage:')
    expect(HELP_TEXT.startsWith('mjst')).toBe(true)
  })
})
