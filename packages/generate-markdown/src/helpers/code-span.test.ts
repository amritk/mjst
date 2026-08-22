import { describe, expect, it } from 'vitest'
import { codeSpan } from '#helpers/code-span'

describe('code-span', () => {
  it('leaves an ordinary value in a single-backtick span', () => {
    expect(codeSpan('port')).toBe('`port`')
  })

  // CommonMark closes a span at the first backtick run of the same length, so
  // the delimiter has to be longer than anything inside.
  it('outruns the longest backtick run inside the value', () => {
    expect(codeSpan('a ` b')).toBe('``a ` b``')
    expect(codeSpan('a ``` b')).toBe('````a ``` b````')
    // Padded only when the value's own edge would be eaten.
    expect(codeSpan('`quoted`')).toBe('`` `quoted` ``')
  })

  // One leading and one trailing space is stripped by the reader, so an edge
  // space in the value needs a pad of its own to survive.
  it('pads a value that begins or ends with a space', () => {
    expect(codeSpan(' lead')).toBe('`  lead `')
    expect(codeSpan('trail ')).toBe('` trail  `')
    expect(codeSpan('\tind')).toBe('` \tind `')
  })

  // The strip only fires when the content is not entirely spaces, so padding an
  // all-spaces value just makes it two spaces wider.
  it('does not pad a value that is only spaces', () => {
    expect(codeSpan('  ')).toBe('`  `')
  })

  it('pads an empty value rather than emitting two backticks', () => {
    expect(codeSpan('')).toBe('`  `')
  })
})
