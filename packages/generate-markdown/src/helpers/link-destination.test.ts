import { describe, expect, it } from 'vitest'
import { linkDestination } from '#helpers/link-destination'

describe('link-destination', () => {
  it('leaves an ordinary page path alone', () => {
    expect(linkDestination('configuration/typescript.md')).toBe('configuration/typescript.md')
  })

  // A fragment and a hyphen are what a cross-page anchor is made of; encoding
  // either one breaks every link the generator writes.
  it('keeps the characters an anchor link is built from', () => {
    expect(linkDestination('guides/sdk-config.md#base-url')).toBe('guides/sdk-config.md#base-url')
  })

  // A space stops the destination being a link at all, and `)` closes it early
  // — the text after it became a second, schema-chosen link.
  it('encodes what would end the destination', () => {
    expect(linkDestination('my docs (v2).md')).toBe('my%20docs%20%28v2%29.md')
  })

  // Uppercase hex and a leading zero: `%A` and `%a0` are not what a byte
  // encodes to, and a reader is entitled to reject either.
  it('writes a percent escape as two uppercase hex digits', () => {
    expect(linkDestination('a\nb')).toBe('a%0Ab')
    expect(linkDestination('é.md')).toBe('%C3%A9.md')
  })
})
