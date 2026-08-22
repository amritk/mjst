import { describe, expect, it } from 'vitest'
import { headingText } from '#helpers/heading-text'

describe('heading-text', () => {
  it('leaves an ordinary property name alone, so the anchor stays readable', () => {
    expect(headingText('darkMode')).toBe('darkMode')
    expect(headingText('publish.npm')).toBe('publish.npm')
    expect(headingText('x-scalar-client-id')).toBe('x-scalar-client-id')
  })

  // Anything markdown would parse has to be contained, or the heading renders
  // as something other than the name.
  it('wraps a name markdown would reinterpret in a code span', () => {
    expect(headingText('*starred*')).toBe('`*starred*`')
    expect(headingText('[link]')).toBe('`[link]`')
    expect(headingText('<script>')).toBe('`<script>`')
    expect(headingText('#hash')).toBe('`#hash`')
  })

  it('widens the code span around a name containing backticks', () => {
    expect(headingText('a`b')).toBe('``a`b``')
  })

  // A line ending in a heading would end the heading and let the rest of the
  // name open a list, a fence, or a raw HTML block.
  it('collapses line endings', () => {
    expect(headingText('two\nlines')).toBe('two lines')
    expect(headingText('two\n# lines')).toBe('`two # lines`')
  })

  it('handles an empty name', () => {
    expect(headingText('')).toBe('`  `')
  })

  // The characters a config key really uses, kept plain so the anchor a docs
  // site generates is the readable `#base-url` a hand-written page would have.
  it('leaves the punctuation a config key uses plain', () => {
    for (const name of ['base_url', 'server.host', 'x-api-key', 'cost$', 'paths/get', 'user@host', 'a b']) {
      expect(headingText(name), name).toBe(name)
    }
  })

  // A leading `-` opens a list item, and a leading digit is fine.
  it('wraps a name that starts with something markdown would read', () => {
    expect(headingText('-flag')).toBe('`-flag`')
    expect(headingText('2fa')).toBe('2fa')
  })
})
