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
    expect(remainingParagraphs('One.\n\n Two. ')).toBe('Two.')
  })

  // Four spaces is what makes an indented code block code; trimming them turned
  // a sample of HTML into live markup on the page.
  it('keeps an indented code block indented', () => {
    const value = 'The template.\n\n    <div>\n      hi\n\n      there\n    </div>\n\nUse it verbatim.'
    expect(remainingParagraphs(value)).toBe('    <div>\n      hi\n\n      there\n    </div>\n\nUse it verbatim.')
  })

  // The blank line inside the block is part of it, so the block does not end
  // there. Asserting this through `remainingParagraphs` proves nothing — it
  // rejoins paragraphs with a blank line, so a torn block comes back identical.
  it('keeps an indented code block whole', () => {
    expect(firstParagraph('    code a\n\n    code b\n\nAfter.')).toBe('code a\n\n    code b')
    expect(remainingParagraphs('    code a\n\n    code b\n\nAfter.')).toBe('After.')
  })

  // A tab indents a code block as surely as four spaces do. (`firstParagraph`
  // trims its own leading whitespace — its result is destined for a one-line
  // table cell — so the indentation itself is checked on the remainder.)
  it('reads a tab-indented block as code too', () => {
    expect(firstParagraph('\tcode a\n\n\tcode b\n\nAfter.')).toBe('code a\n\n\tcode b')
    expect(remainingParagraphs('Intro.\n\n\t<div>')).toBe('\t<div>')
  })

  // Three spaces is not code in CommonMark, so the blank line ends the
  // paragraph and the indentation carries no meaning worth keeping.
  it('does not read three spaces as code', () => {
    expect(firstParagraph('   lazy a\n\n   lazy b')).toBe('lazy a')
    expect(remainingParagraphs('Intro.\n\n  two spaces')).toBe('two spaces')
  })

  // CommonMark closes a fence on a run at least as long as the opener, so a
  // ``` line inside a ```` block is sample text.
  it('closes a fence only on a run as long as the one that opened it', () => {
    const value = 'Intro.\n````md\n```js\nconst a = 1\n\nconst b = 2\n```\n````'
    expect(firstParagraph(value)).toBe(value)
    expect(remainingParagraphs(value)).toBe('')
  })

  it('reads nothing after a single paragraph', () => {
    expect(remainingParagraphs('Only one.')).toBe('')
  })

  // An unclosed fence runs to the end of the value, trailing blank lines and
  // all, and those would otherwise leak into the block below a table row.
  it('drops the trailing blank lines of the last paragraph', () => {
    expect(remainingParagraphs('A.\n\nIntro.\n```\ncode\n\n')).toBe('Intro.\n```\ncode')
  })

  // The paragraphs stay paragraphs: joining them with one newline would run
  // three of them together into a single block of prose.
  it('keeps the remaining paragraphs separated', () => {
    expect(remainingParagraphs('One.\n\nTwo.\n\nThree.')).toBe('Two.\n\nThree.')
  })

  // A blank line inside a fence is part of the sample. Splitting on it took the
  // fence apart, and printing the second half opened one that never closed.
  it('keeps a fenced block whole', () => {
    const value = 'Intro.\n```json\n{\n  "a": 1,\n\n  "b": 2\n}\n```'
    expect(firstParagraph(value)).toBe(value)
    expect(remainingParagraphs(value)).toBe('')
  })

  it('keeps a tilde fence whole', () => {
    const value = 'Intro.\n~~~\nline\n\nline\n~~~'
    expect(firstParagraph(value)).toBe(value)
  })

  // A fence closes on its own character: a `~~~` line inside a backtick fence
  // is sample text, not the end of the block.
  it('does not close a backtick fence with a tilde one', () => {
    const value = 'Intro.\n```\n~~~\n\nstill inside\n```'
    expect(firstParagraph(value)).toBe(value)
  })

  it('reads a fence that opens the description', () => {
    const value = '```\na\n\nb\n```\n\nAfter.'
    expect(firstParagraph(value)).toBe('```\na\n\nb\n```')
    expect(remainingParagraphs(value)).toBe('After.')
  })

  // Four spaces makes an indented code block, not a fence, so the line does not
  // open one and the blank line after it still ends the paragraph.
  it('does not open a fence from an indented code block', () => {
    expect(firstParagraph('Intro.\n    ```\n\nAfter.')).toBe('Intro.\n    ```')
    expect(remainingParagraphs('Intro.\n    ```\n\nAfter.')).toBe('After.')
  })

  // Two backticks at the start of a line are a code span, not a fence, so the
  // blank line after them still ends the paragraph.
  it('needs three markers to open a fence', () => {
    expect(remainingParagraphs('Intro.\n``\n\nAfter.')).toBe('After.')
    expect(firstParagraph('Intro.\n``\n\nAfter.')).toBe('Intro.\n``')
  })

  // An unclosed fence runs to the end, so nothing after it is a new paragraph.
  it('runs an unclosed fence to the end', () => {
    const value = 'Intro.\n```\nstill inside\n\nstill inside'
    expect(firstParagraph(value)).toBe(value)
    expect(remainingParagraphs(value)).toBe('')
  })
})
