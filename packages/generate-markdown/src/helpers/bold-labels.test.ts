import { describe, expect, it } from 'vitest'
import { boldLabels } from '#helpers/bold-labels'

const labels = (...lines: readonly string[]): ReturnType<typeof boldLabels> => boldLabels(lines)

describe('bold-labels', () => {
  it('finds a paragraph that is one bold span', () => {
    expect(labels('Intro.', '', '**First release**', '', 'Body.')).toEqual([
      { start: 2, end: 3, lead: 'First release' },
    ])
  })

  it('accepts underscores and a trailing colon after the span', () => {
    expect(labels('__First release__')).toEqual([{ start: 0, end: 1, lead: 'First release' }])
    expect(labels('**First release**:')).toEqual([{ start: 0, end: 1, lead: 'First release' }])
  })

  it('keeps the inline markdown inside the span as written', () => {
    expect(labels('**Publish with `npm`**')).toEqual([{ start: 0, end: 1, lead: 'Publish with `npm`' }])
  })

  // A soft line break inside the span is still one paragraph of bold text.
  it('reads a span that wraps across lines', () => {
    expect(labels('**Switch to trusted**', 'publishing**')).toEqual([])
    expect(labels('**Switch to trusted', 'publishing**')).toEqual([
      { start: 0, end: 2, lead: 'Switch to trusted\npublishing' },
    ])
  })

  it('leaves a bold lead-in to a longer paragraph alone', () => {
    expect(labels('**Note.** The token expires.')).toEqual([])
    expect(labels('**Note.**', 'The token expires.')).toEqual([])
  })

  it('leaves two spans, an escaped closer and a bare colon alone', () => {
    expect(labels('**One** and **two**')).toEqual([])
    expect(labels('**One\\**')).toEqual([])
    expect(labels('**One**::')).toEqual([])
    expect(labels('** spaced **')).toEqual([])
  })

  it('ignores bold-only paragraphs inside a fence, a blockquote, a list or raw HTML', () => {
    expect(labels('```md', '**Fenced**', '```')).toEqual([])
    expect(labels('> **Quoted**')).toEqual([])
    expect(labels('> [!NOTE]', '> **Callout**')).toEqual([])
    expect(labels('- **Listed**')).toEqual([])
    expect(labels('1. **Step.** Body.', '', '   **In the step**')).toEqual([])
    expect(labels('<!--', '', '**Hidden**', '', '-->')).toEqual([])
    expect(labels('<div>', '**Raw**', '</div>')).toEqual([])
  })

  // `> intro` with an unmarked line under it is still one quote.
  it('ignores a line that lazily continues a blockquote', () => {
    expect(labels('> Intro', '**Lazy**')).toEqual([])
  })

  it('ignores an indented code block and a setext heading', () => {
    expect(labels('    **Code**')).toEqual([])
    expect(labels('**Already a heading**', '---')).toEqual([])
    expect(labels('**Already a heading**', '===')).toEqual([])
  })

  it('finds a label straight above a list it does not belong to', () => {
    expect(labels('**First release**', '1. **Create a token.** x')).toEqual([
      { start: 0, end: 1, lead: 'First release' },
    ])
  })

  it('finds a label right after a list that ended before it', () => {
    expect(labels('- item', '', '**After**')).toEqual([{ start: 2, end: 3, lead: 'After' }])
  })
})
