import { describe, expect, it } from 'vitest'
import { topLevelBlocks } from '#helpers/markdown-blocks'

/** The kind and line span of each block, which is what callers act on. */
const spans = (...lines: readonly string[]): readonly (readonly [string, number, number])[] =>
  topLevelBlocks(lines).map((block) => [block.kind, block.start, block.end] as const)

describe('markdown-blocks', () => {
  it('reports paragraphs and lists with the lines they span', () => {
    expect(spans('Intro', 'more.', '', '1. One', '2. Two', '', 'After.')).toEqual([
      ['paragraph', 0, 2],
      ['list', 3, 5],
      ['paragraph', 6, 7],
    ])
  })

  it('ends a paragraph at a line that interrupts it, and not at one that does not', () => {
    expect(spans('Intro', '1. One')).toEqual([
      ['paragraph', 0, 1],
      ['list', 1, 2],
    ])
    expect(spans('Wrapped at', '2. still prose')).toEqual([['paragraph', 0, 2]])
    expect(spans('Intro', '# Heading', 'After')).toEqual([
      ['paragraph', 0, 1],
      ['paragraph', 2, 3],
    ])
  })

  it('skips fences, raw HTML, blockquotes, headings and indented code', () => {
    expect(spans('```', 'code', '', 'more', '```')).toEqual([])
    expect(spans('<!--', '', 'hidden', '', '-->')).toEqual([])
    expect(spans('<div>', 'raw', '', 'Out.')).toEqual([['paragraph', 3, 4]])
    expect(spans('> quote', 'lazy', '', 'Out.')).toEqual([['paragraph', 3, 4]])
    expect(spans('# Title', '    code')).toEqual([])
  })

  it('reads a paragraph under a setext underline as a heading', () => {
    expect(spans('Title', '---', 'Body')).toEqual([['paragraph', 2, 3]])
    expect(spans('Title', '===')).toEqual([])
  })

  it('reads a list whole, its lazy and indented lines included', () => {
    expect(spans('1. One', 'lazy', '', '   indented', '2. Two', '', 'After')).toEqual([
      ['list', 0, 5],
      ['paragraph', 6, 7],
    ])
  })
})
