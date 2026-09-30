import { describe, expect, it } from 'vitest'
import { stepTitle } from '#helpers/step-title'

describe('step-title', () => {
  it('drops one trailing period or colon', () => {
    expect(stepTitle('Create an access token.')).toBe('Create an access token')
    expect(stepTitle('Add a secret:')).toBe('Add a secret')
    expect(stepTitle('Wait...')).toBe('Wait..')
  })

  it('keeps the text of a code span and drops its backticks', () => {
    expect(stepTitle('Set `NPM_TOKEN`.')).toBe('Set NPM_TOKEN')
    expect(stepTitle('Run `` a`b ``')).toBe('Run a`b')
  })

  // An underscore inside a word is part of the word, not emphasis.
  it('strips emphasis without touching a snake_case word', () => {
    expect(stepTitle('Set *the* _real_ ~~old~~ snake_case value')).toBe('Set the real old snake_case value')
  })

  it('keeps the text of a link and drops its destination', () => {
    expect(stepTitle('Read [the guide](https://example.com)')).toBe('Read the guide')
  })

  it('drops raw HTML tags but keeps a comparison', () => {
    expect(stepTitle('Use <b>bold</b> when a < b')).toBe('Use bold when a < b')
  })

  it('keeps a backslash-escaped character as written', () => {
    expect(stepTitle('Match \\*.md')).toBe('Match *.md')
  })

  it('collapses whitespace and line endings', () => {
    expect(stepTitle('  Create\n  a   token  ')).toBe('Create a token')
  })

  // Plain text on the way out: escaping is the caller's, since it depends on
  // where the title lands.
  it('does not escape HTML', () => {
    expect(stepTitle('Tom & "Jerry"')).toBe('Tom & "Jerry"')
  })
})
