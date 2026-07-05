import { describe, expect, it } from 'vitest'

import { generateIndexBarrel } from './generate-index-barrel'

describe('generate-index-barrel', () => {
  it('re-exports types and consts, sorted by filename', () => {
    const files = [
      { filename: 'contact.ts', content: 'export type Contact = {}\nexport const parseContact = () => {}\n' },
      { filename: 'address.ts', content: 'export type Address = {}\nexport const parseAddress = () => {}\n' },
    ]

    expect(generateIndexBarrel(files)).toBe(
      "export { type Address, parseAddress } from './address.js';\n" +
        "export { type Contact, parseContact } from './contact.js';\n",
    )
  })

  it('emits type-only re-exports when typesOnly is set', () => {
    const files = [{ filename: 'contact.ts', content: 'export type Contact = {}\n' }]

    expect(generateIndexBarrel(files, { typesOnly: true })).toBe("export type { Contact } from './contact.js';\n")
  })

  it('never re-exports internal _helpers modules', () => {
    const files = [
      { filename: 'document.ts', content: 'export type Document = {}\n' },
      { filename: '_helpers/is-object.ts', content: 'export const isObject = () => {}\n' },
    ]

    expect(generateIndexBarrel(files)).toBe("export { type Document } from './document.js';\n")
  })

  it('skips files that export nothing', () => {
    const files = [
      { filename: 'document.ts', content: 'export type Document = {}\n' },
      { filename: 'empty.ts', content: '// nothing here\n' },
    ]

    expect(generateIndexBarrel(files)).toBe("export { type Document } from './document.js';\n")
  })
})
