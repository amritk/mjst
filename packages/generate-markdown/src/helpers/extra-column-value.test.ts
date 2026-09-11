import { describe, expect, it } from 'vitest'
import { extraColumnValue } from '#helpers/extra-column-value'

describe('extra-column-value', () => {
  it('reads a string value', () => {
    expect(extraColumnValue({ 'x-scalar-stability': 'experimental' }, 'x-scalar-stability')).toBe('experimental')
  })

  it('renders a number or a boolean', () => {
    expect(extraColumnValue({ 'x-since': 3 }, 'x-since')).toBe('3')
    expect(extraColumnValue({ 'x-internal': false }, 'x-internal')).toBe('false')
  })

  it('is empty when the property does not carry the keyword', () => {
    expect(extraColumnValue({ type: 'string' }, 'x-scalar-stability')).toBe('')
  })

  // `[object Object]` in a cell helps nobody, and an empty cell is what lets the
  // column disappear when nothing fills it.
  it('is empty for a value that has no obvious cell rendering', () => {
    expect(extraColumnValue({ 'x-tags': ['a', 'b'] }, 'x-tags')).toBe('')
    expect(extraColumnValue({ 'x-meta': { a: 1 } }, 'x-meta')).toBe('')
    expect(extraColumnValue({ 'x-nothing': null }, 'x-nothing')).toBe('')
  })

  // The value is schema-controlled text, so it cannot be allowed to carry markup
  // into the table.
  it('escapes HTML in the value', () => {
    expect(extraColumnValue({ 'x-note': '<b>a</b> & b' }, 'x-note')).toBe('&lt;b&gt;a&lt;/b&gt; &amp; b')
  })

  // A line ending inside a cell ends the surrounding `<table>` block mid-row.
  it('collapses line endings in the value', () => {
    expect(extraColumnValue({ 'x-note': 'a\nb' }, 'x-note')).toBe('a b')
  })
})
