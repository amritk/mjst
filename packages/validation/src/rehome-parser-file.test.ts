import { describe, expect, it } from 'vitest'

import { rehomeParserFile } from './rehome-parser-file'

/**
 * The surgery in isolation. `generate.test.ts` proves the whole output compiles,
 * which is the claim that matters; this pins the shapes that would make it stop
 * compiling, so a failure says which rule broke rather than just "TS6133
 * somewhere".
 */
describe('rehomeParserFile', () => {
  it('replaces an object type declaration with an import of it', () => {
    const source = [
      'export type Doc = {',
      '  n: number;',
      '};',
      '',
      'export const parseDoc = (i: unknown): Doc => i as Doc;',
    ].join('\n')

    const result = rehomeParserFile(source, 'doc', '.parse')

    expect(result).toContain("import type { Doc } from './doc.js';")
    expect(result).not.toContain('export type Doc =')
    expect(result).toContain('export const parseDoc')
  })

  it('handles a scalar root, which closes on the first semicolon', () => {
    const source = 'export type Doc = string;\n\nexport const parseDoc = (i: unknown): Doc => i as Doc;'

    const result = rehomeParserFile(source, 'doc', '.parse')

    expect(result).not.toContain('export type Doc = string')
    expect(result).toContain("import type { Doc } from './doc.js';")
  })

  it('does not stop at a semicolon nested inside the declaration', () => {
    const source = [
      'export type Doc = {',
      '  inner: { a: string; b: number };',
      '};',
      '',
      'export const parseDoc = (): Doc => 0 as never;',
    ].join('\n')

    const result = rehomeParserFile(source, 'doc', '.parse')

    expect(result).not.toContain('inner:')
    expect(result).toContain('export const parseDoc')
  })

  // A member's JSDoc is the schema description verbatim. Read as code, the
  // apostrophe opened a string that swallowed the closing braces, and the
  // declaration ended early, leaving a stray `};` the file failed to parse on.
  it('does not read quotes inside a comment in the declaration', () => {
    const source = [
      'export type Doc = "auto" | {',
      "  /** The model's default limits. */",
      '  limits?: {',
      "    /** At most the model's window (`0.0` - `1.0`). */",
      '    post?: number;',
      '  };',
      "  // the user's choice",
      '  ratio: number;',
      '};',
      '',
      'export const parseDoc = (): Doc => "auto";',
    ].join('\n')

    const result = rehomeParserFile(source, 'doc', '.parse')

    expect(result).not.toContain('ratio')
    expect(result).not.toContain('post?')
    expect(result).not.toContain('};')
    expect(result).toContain('export const parseDoc')
  })

  it('does not stop at a brace or semicolon inside a string literal', () => {
    const source = ['export type Doc = "a;b" | "c}d";', '', 'export const parseDoc = (): Doc => "a;b";'].join('\n')

    const result = rehomeParserFile(source, 'doc', '.parse')

    expect(result).not.toContain('export type Doc =')
    expect(result).toContain('export const parseDoc')
  })

  it('points a sibling import at the parser half, keeping its type half in place', () => {
    const source = [
      "import { type Inner, parseInner, validateInnerShape } from './inner.js';",
      '',
      'export type Doc = { r: Inner };',
      '',
      'export const parseDoc = (i: unknown): Doc => {',
      '  const r: Inner = parseInner(i);',
      '  return { r, ok: validateInnerShape(i) } as never;',
      '};',
    ].join('\n')

    const result = rehomeParserFile(source, 'doc', '.parse')

    // The body still annotates with `Inner`, so the type half is kept; the value
    // half follows the functions into the parser file.
    expect(result).toContain("import type { Inner } from './inner.js';")
    expect(result).toContain("import { parseInner, validateInnerShape } from './inner.parse.js';")
  })

  it('leaves a helper import alone, because helpers keep the one name they were emitted under', () => {
    const source = [
      "import { isObject } from './_helpers/is-object.js';",
      '',
      'export type Doc = { n: number };',
      '',
      'export const parseDoc = (i: unknown): Doc => (isObject(i) ? i : { n: 0 }) as Doc;',
    ].join('\n')

    const result = rehomeParserFile(source, 'doc', '.parse')

    expect(result).toContain("import { isObject } from './_helpers/is-object.js';")
    expect(result).not.toContain('is-object.parse.js')
  })

  it('drops an import the removed declaration was the only reader of', () => {
    // `Inner` was named by `export type Doc` and by nothing else. Left behind it
    // is TS6133 in the consumer's build.
    const source = [
      "import { type Inner } from './inner.js';",
      '',
      'export type Doc = { r: Inner };',
      '',
      'export const parseDoc = (i: unknown): Doc => i as Doc;',
    ].join('\n')

    const result = rehomeParserFile(source, 'doc', '.parse')

    expect(result).not.toContain('Inner }')
    expect(result).toContain("import type { Doc } from './doc.js';")
  })

  it('hands back a file that declares no type, untouched', () => {
    const source = "export const isObject = (i: unknown): boolean => typeof i === 'object';"

    expect(rehomeParserFile(source, '_helpers/is-object', '.parse')).toBe(source)
  })
})
