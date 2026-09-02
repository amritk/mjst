import { describe, expect, it } from 'vitest'

import { generateIndexBarrel } from './generate-index-barrel'

describe('generate-index-barrel', () => {
  it('re-exports types and consts, sorted by filename', () => {
    const files = [
      { filename: 'contact.ts', content: 'export type Contact = {}\nexport const parseContact = () => {}\n' },
      { filename: 'address.ts', content: 'export type Address = {}\nexport const parseAddress = () => {}\n' },
    ]

    // Values come through `const` aliases, not `export … from`: TypeScript
    // lowers a re-export to a CommonJS *getter*, and every call through the
    // barrel then pays for one. Types keep the re-export form — a type cannot
    // be aliased through a `const`, and emits no runtime code either way.
    expect(generateIndexBarrel(files)).toBe(
      "import { parseAddress as parseAddress$0 } from './address.js';\n" +
        "import { parseContact as parseContact$1 } from './contact.js';\n" +
        '\n' +
        "export type { Address } from './address.js';\n" +
        "export type { Contact } from './contact.js';\n" +
        '\n' +
        'export const parseAddress = parseAddress$0;\n' +
        'export const parseContact = parseContact$1;\n',
    )
  })

  // An alias is only ever local to the barrel, but it still must not shadow a
  // name the barrel declares.
  it('renames an alias that would collide with a real export', () => {
    const files = [
      { filename: 'a.ts', content: 'export const parseA = 1;\n' },
      // The name module a's alias would otherwise take.
      { filename: 'b.ts', content: 'export const parseA$0 = 2;\n' },
    ]

    const barrel = generateIndexBarrel(files)
    expect(barrel).toContain("import { parseA as parseA$0$ } from './a.js';")
    expect(barrel).toContain('export const parseA = parseA$0$;')
    expect(barrel).toContain("import { parseA$0 as parseA$0$1 } from './b.js';")
    expect(barrel).toContain('export const parseA$0 = parseA$0$1;')
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
    expect(generateIndexBarrel([{ filename: 'a.ts', content: cr }])).toBe(
      "import { parseA as parseA$0 } from './a.js';\n\nexport type { A } from './a.js';\n\nexport const parseA = parseA$0;\n",
    )

    const ls = 'type X = 1;\u2028export const parseB = 1;'
    expect(generateIndexBarrel([{ filename: 'b.ts', content: ls }])).toBe(
      "import { parseB as parseB$0 } from './b.js';\n\nexport const parseB = parseB$0;\n",
    )

    const crlf = 'type X = 1;\r\nexport const parseC = 1;'
    expect(generateIndexBarrel([{ filename: 'c.ts', content: crlf }])).toBe(
      "import { parseC as parseC$0 } from './c.js';\n\nexport const parseC = parseC$0;\n",
    )
  })

  it('emits .ts specifiers when importExt is ts', () => {
    const files = [{ filename: 'contact.ts', content: 'export type Contact = {};\nexport const parseContact = 1;' }]
    expect(generateIndexBarrel(files, { importExt: 'ts' })).toBe(
      "import { parseContact as parseContact$0 } from './contact.ts';\n" +
        '\n' +
        "export type { Contact } from './contact.ts';\n" +
        '\n' +
        'export const parseContact = parseContact$0;\n',
    )
  })

  it('never re-exports internal _helpers modules', () => {
    const files = [
      { filename: 'document.ts', content: 'export type Document = {}\n' },
      { filename: '_helpers/is-object.ts', content: 'export const isObject = () => {}\n' },
    ]

    expect(generateIndexBarrel(files)).toBe("export type { Document } from './document.js';\n")
  })

  it('skips files that export nothing', () => {
    const files = [
      { filename: 'document.ts', content: 'export type Document = {}\n' },
      { filename: 'empty.ts', content: '// nothing here\n' },
    ]

    expect(generateIndexBarrel(files)).toBe("export type { Document } from './document.js';\n")
  })
})
