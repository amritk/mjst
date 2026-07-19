import { describe, expect, it } from 'vitest'

import { COMPILE_API_HELP_TEXT } from './help-text'

describe('help-text', () => {
  // Hand-written constant, so this list is the guard that a new compile-api
  // flag cannot ship without appearing in `mjst compile-api --help`.
  it('lists every supported flag', () => {
    const flags = ['--out', '--routes-import', '--options', '--open-api-path', '--max-body-bytes', '--help']
    for (const flag of flags) {
      expect(COMPILE_API_HELP_TEXT).toContain(flag)
    }
  })

  it('starts with a usage synopsis', () => {
    expect(COMPILE_API_HELP_TEXT.startsWith('mjst compile-api')).toBe(true)
    expect(COMPILE_API_HELP_TEXT).toContain('Usage:')
  })
})
