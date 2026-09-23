import { describe, expect, it } from 'vitest'
import { headingText, propertyHeading } from '#helpers/heading-text'

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

  // Every character a config key may carry and still be read as itself. One
  // missing from the set turns a readable heading into a code span, which
  // changes the anchor a docs site generates for it.
  it('keeps every character a plain name may end with', () => {
    for (const name of ['ab-', 'ab.', 'ab_', 'ab/', 'ab@', 'ab$']) expect(headingText(name), name).toBe(name)
  })

  // The first character is narrower: `_ab` and `-ab` both open something.
  it('wraps a name that starts with punctuation', () => {
    expect(headingText('_ab')).toBe('`_ab`')
  })

  // A leading `-` opens a list item, and a leading digit is fine.
  it('wraps a name that starts with something markdown would read', () => {
    expect(headingText('-flag')).toBe('`-flag`')
    expect(headingText('2fa')).toBe('2fa')
  })

  // The markdown and the text are handed out together so a link into the page
  // cannot name an anchor the heading above it does not have.
  it('gives a property heading both the markdown to print and the text a reader sees', () => {
    expect(propertyHeading('base_url', undefined)).toEqual({ markdown: 'base_url', text: 'base_url' })
    // The code span is markup: a reader is left with the name itself.
    expect(propertyHeading('-flag', undefined)).toEqual({ markdown: '`-flag`', text: '-flag' })
  })

  it('lets an x-mjst title replace both of them', () => {
    expect(propertyHeading('targets', 'SDK targets')).toEqual({ markdown: 'SDK targets', text: 'SDK targets' })
  })

  // A title of whitespace is not a title: honouring it left an empty heading
  // where the property's name should be.
  it('falls back to the name when the title is blank', () => {
    expect(propertyHeading('targets', '   ').markdown).toBe('targets')
  })

  // The escape keeps the title prose; the reader still sees the `#`, and the
  // anchor is slugged from what they see.
  it('escapes the closing hashes of a title without carrying them into the text', () => {
    expect(propertyHeading('a', 'Advanced #')).toEqual({ markdown: 'Advanced \\#', text: 'Advanced #' })
  })
})
