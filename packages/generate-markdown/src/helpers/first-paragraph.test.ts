import { describe, expect, it } from 'vitest'
import { firstParagraph, remainingParagraphs } from '#helpers/first-paragraph'

describe('first-paragraph', () => {
  it('takes everything up to the first blank line', () => {
    expect(firstParagraph('One.\nStill one.\n\nTwo.')).toBe('One.\nStill one.')
  })

  it('takes the whole text when there is no blank line', () => {
    expect(firstParagraph('Only one.')).toBe('Only one.')
  })

  // Spelling the alternation inline lets a regex engine hand a `\r` to one
  // branch and the `\n` to the other, which cuts a CRLF document off after its
  // first line. Normalising first is what prevents that.
  it('reads a CRLF document the same as an LF one', () => {
    expect(firstParagraph('One.\r\nStill one.\r\n\r\nTwo.')).toBe('One.\nStill one.')
    expect(remainingParagraphs('One.\r\n\r\nTwo.\r\n\r\nThree.')).toBe('Two.\n\nThree.')
  })

  it('treats a blank line holding spaces or tabs as a blank line', () => {
    expect(firstParagraph('One.\n \t \nTwo.')).toBe('One.')
    expect(remainingParagraphs('One.\n \t \nTwo.')).toBe('Two.')
  })

  it('trims the surrounding whitespace', () => {
    expect(firstParagraph('  One.  \n\nTwo.')).toBe('One.')
    expect(remainingParagraphs('One.\n\n  Two.  ')).toBe('Two.')
  })

  it('reads nothing after a single paragraph', () => {
    expect(remainingParagraphs('Only one.')).toBe('')
  })

  // The paragraphs stay paragraphs: joining them with one newline would run
  // three of them together into a single block of prose.
  it('keeps the remaining paragraphs separated', () => {
    expect(remainingParagraphs('One.\n\nTwo.\n\nThree.')).toBe('Two.\n\nThree.')
  })
})
