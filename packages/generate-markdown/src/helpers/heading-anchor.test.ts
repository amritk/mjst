import { describe, expect, it } from 'vitest'
import { headingAnchor } from '#helpers/heading-anchor'
import { propertyHeading } from '#helpers/heading-text'

describe('heading-anchor', () => {
  it('lowercases and hyphenates a heading', () => {
    expect(headingAnchor('SDK targets')).toBe('sdk-targets')
  })

  it('drops the punctuation a property name is full of', () => {
    expect(headingAnchor('foo.bar')).toBe('foobar')
    expect(headingAnchor('$ref')).toBe('ref')
    expect(headingAnchor('on:push')).toBe('onpush')
  })

  it('keeps the hyphens and underscores a name already has', () => {
    expect(headingAnchor('on-load_v2')).toBe('on-load_v2')
  })

  // A docs site keeps them in the id, and stripping them would leave a heading
  // in a non-latin script with no anchor at all.
  it('keeps letters outside the latin alphabet', () => {
    expect(headingAnchor('Уровень логирования')).toBe('уровень-логирования')
  })

  // ATX headings drop their own edge whitespace, so an anchor never carries it.
  it('ignores whitespace around the heading', () => {
    expect(headingAnchor('  trail  ')).toBe('trail')
  })

  // The caller reads an empty anchor as "there is nothing here to link to",
  // which beats a link to `#` that only ever scrolls to the top of the page.
  it('gives a heading of pure punctuation no anchor at all', () => {
    expect(headingAnchor('***')).toBe('')
  })

  // The backticks are markup: the reader sees the same words either way, and a
  // docs site slugs what the reader sees.
  it('agrees with a property heading whether or not its name needs a code span', () => {
    expect(headingAnchor(propertyHeading('foo.bar', undefined).text)).toBe('foobar')
    expect(headingAnchor(propertyHeading('foo|bar', undefined).text)).toBe('foobar')
    expect(propertyHeading('foo|bar', undefined).markdown).toBe('`foo|bar`')
  })
})
