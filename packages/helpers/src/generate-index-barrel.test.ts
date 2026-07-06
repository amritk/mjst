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

  // Review pin: the line walk must treat every JS LineTerminator as a line
  // start, like the /m regexes it replaced — CR-only and U+2028/U+2029 files
  // silently lost their exports otherwise.
  it('collects exports after every JS line-terminator flavor', () => {
    const cr = 'type X = 1;\rexport const parseA = 1;\rexport type A = 2;'
    expect(generateIndexBarrel([{ filename: 'a.ts', content: cr }])).toBe("export { type A, parseA } from './a.js';\n")

    const ls = 'type X = 1;\u2028export const parseB = 1;'
    expect(generateIndexBarrel([{ filename: 'b.ts', content: ls }])).toBe("export { parseB } from './b.js';\n")

    const crlf = 'type X = 1;\r\nexport const parseC = 1;'
    expect(generateIndexBarrel([{ filename: 'c.ts', content: crlf }])).toBe("export { parseC } from './c.js';\n")
  })

  it('emits .ts specifiers when importExt is ts', () => {
    const files = [{ filename: 'contact.ts', content: 'export type Contact = {};\nexport const parseContact = 1;' }]
    expect(generateIndexBarrel(files, { importExt: 'ts' })).toBe(
      "export { type Contact, parseContact } from './contact.ts';\n",
    )
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
