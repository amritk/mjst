import { describe, expect, it } from 'vitest'
import { collapseLineEndings, escapeHtml } from '#helpers/escape-html'

describe('escape-html', () => {
  // Every one of these ends a line for something that will read the output: CR
  // for CommonMark, U+2028 and U+2029 for the JS regexes every JavaScript
  // markdown renderer is built on.
  it('collapses each character a renderer treats as a line ending', () => {
    expect(collapseLineEndings('a\nb')).toBe('a b')
    expect(collapseLineEndings('a\rb')).toBe('a b')
    expect(collapseLineEndings('a\r\nb')).toBe('a b')
    expect(collapseLineEndings('a b')).toBe('a b')
    expect(collapseLineEndings('a b')).toBe('a b')
  })

  it('collapses a run of them to one space', () => {
    expect(collapseLineEndings('a\n\n\r\n b')).toBe('a b')
  })

  it('leaves text with no line ending alone', () => {
    expect(collapseLineEndings('a b\tc')).toBe('a b\tc')
  })

  it('escapes the characters that would open a tag or an entity', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href="x"&gt;&amp;&lt;/a&gt;')
  })

  it('escapes ampersands before the brackets, so an entity is not double-escaped', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })

  it('collapses line endings on the way through', () => {
    expect(escapeHtml('a\rb')).toBe('a b')
  })
})
