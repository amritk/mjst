import { describe, expect, it } from 'vitest'
import { stepLists } from '#helpers/step-lists'

const lists = (...lines: readonly string[]): ReturnType<typeof stepLists> => stepLists(lines)

describe('step-lists', () => {
  it('finds an ordered list whose every item opens with a bold lead-in', () => {
    expect(lists('Intro.', '', '1. **One.** First.', '2. **Two.** Second.', '', 'After.')).toEqual([
      {
        start: 2,
        end: 4,
        items: [
          { lead: 'One.', body: 'First.' },
          { lead: 'Two.', body: 'Second.' },
        ],
      },
    ])
  })

  it('leaves a list alone when any item lacks the lead-in', () => {
    expect(lists('1. **One.** First.', '2. Second.')).toEqual([])
  })

  it('leaves a bullet list alone', () => {
    expect(lists('- **One.** First.', '- **Two.** Second.')).toEqual([])
  })

  it('ignores a list inside a fence', () => {
    expect(lists('```md', '1. **One.** First.', '```')).toEqual([])
    expect(lists('~~~~', '```', '1. **One.** First.', '~~~~')).toEqual([])
  })

  it('ignores a list nested inside another list', () => {
    expect(lists('- Outer', '', '  1. **One.** First.')).toEqual([])
  })

  it('ignores a list inside a blockquote', () => {
    expect(lists('> 1. **One.** First.')).toEqual([])
  })

  // CommonMark: only a list starting at 1 can interrupt a paragraph.
  it('reads an ordered line mid-paragraph as prose unless it starts at 1', () => {
    expect(lists('Wrapped at', '2. **Two.** Still prose.')).toEqual([])
    expect(lists('Intro:', '1. **One.** A list.')).toHaveLength(1)
  })

  it('de-indents nested bullets and a fence into the body', () => {
    const [list] = lists(
      '1. **Install.** Run it.',
      '   - on macOS',
      '   - on Linux',
      '',
      '   ```sh',
      '   npm i',
      '',
      '     indented',
      '   ```',
      '2. **Done.**',
    )
    expect(list?.items).toEqual([
      { lead: 'Install.', body: 'Run it.\n- on macOS\n- on Linux\n\n```sh\nnpm i\n\n  indented\n```' },
      { lead: 'Done.', body: '' },
    ])
    expect(list?.end).toBe(10)
  })

  it('takes a lazy continuation line into the item', () => {
    expect(lists('1. **One.** First', 'still first.', '2. **Two.**')[0]?.items[0]).toEqual({
      lead: 'One.',
      body: 'First\nstill first.',
    })
  })

  it('ends the list at an unindented paragraph after a blank line', () => {
    const [list] = lists('1. **One.** First.', '', '2. **Two.** Second.', '', 'Not in the list.')
    expect(list?.end).toBe(3)
    expect(list?.items.map((item) => item.body)).toEqual(['First.', 'Second.'])
  })

  // A fence inside an item ends with the item when a line is not indented into it.
  it('ends an item and its fence at an unindented line', () => {
    const [list] = lists('1. **One.**', '   ```', '   code', '```')
    expect(list?.end).toBe(3)
    expect(list?.items[0]?.body).toBe('```\ncode')
  })

  it('treats `1.` and `1)` as two lists', () => {
    expect(lists('1. **One.** a', '1) **Two.** b').map((list) => list.items.length)).toEqual([1, 1])
  })

  it('accepts the punctuation outside the bold', () => {
    expect(lists('1. **One**: a')[0]?.items[0]).toEqual({ lead: 'One', body: 'a' })
  })

  // `**a**b` is one word, half of it bold, not a title followed by a body.
  it('needs whitespace after the lead-in', () => {
    expect(lists('1. **a**b')).toEqual([])
  })

  it('needs the lead-in to open the item', () => {
    expect(lists('1. Then **bold.** text')).toEqual([])
  })

  it('finds each qualifying list, whatever sits between them', () => {
    const found = lists('1. **A.** a', '', 'Prose.', '', '1. **B.** b', '2. plain')
    expect(found.map((list) => list.start)).toEqual([0])
  })

  it('reads a list after an indented code block that looks like one', () => {
    expect(lists('    1. **Code.** not a list')).toEqual([])
  })
})
