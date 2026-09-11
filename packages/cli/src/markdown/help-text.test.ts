import { describe, expect, it } from 'vitest'

import { MARKDOWN_HELP_TEXT } from './help-text'

describe('help-text', () => {
  // The help is a hand-written constant, so this list is the guard that a new
  // flag cannot ship without appearing in `mjst markdown --help`.
  it('lists every supported flag', () => {
    const flags = [
      '--out-dir',
      '--file',
      '--title',
      '--language',
      '--layout',
      '--sort',
      '--heading-level',
      '--table',
      '--readme',
      '--help',
    ]
    for (const flag of flags) {
      expect(MARKDOWN_HELP_TEXT).toContain(flag)
    }
  })

  it('starts with a usage synopsis', () => {
    expect(MARKDOWN_HELP_TEXT).toContain('Usage:')
    expect(MARKDOWN_HELP_TEXT.startsWith('mjst markdown')).toBe(true)
  })
})
