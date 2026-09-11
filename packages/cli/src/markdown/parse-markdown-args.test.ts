import { describe, expect, it } from 'vitest'

import { parseMarkdownArgs } from './parse-markdown-args'

describe('parse-markdown-args', () => {
  it('reads the schema positional and the page flags', () => {
    const args = parseMarkdownArgs([
      './config.schema.json',
      '--out-dir',
      'docs',
      '--file',
      'config.md',
      '--title',
      'Configuration',
      '--language',
      'javascript',
      '--layout',
      'table',
      '--sort',
      'alphabetical',
      '--heading-level',
      '2',
    ])
    expect(args).toEqual({
      schema: './config.schema.json',
      outDir: 'docs',
      file: 'config.md',
      title: 'Configuration',
      language: 'javascript',
      layout: 'table',
      sort: 'alphabetical',
      headingLevel: 2,
    })
  })

  it('accepts the --flag=value spelling and camelCase flag names', () => {
    expect(parseMarkdownArgs(['s.json', '--out-dir=docs', '--headingLevel=3'])).toEqual({
      schema: 's.json',
      outDir: 'docs',
      headingLevel: 3,
    })
  })

  it('reads the table flags', () => {
    expect(parseMarkdownArgs(['s.json', '--table', '--readme', 'docs/config.md'])).toEqual({
      schema: 's.json',
      table: true,
      readme: 'docs/config.md',
    })
  })

  // An unknown layout or sort reaches the renderer as "not set" and falls back
  // to the default, so a typo would quietly produce the wrong pages.
  it('rejects a layout or sort it does not know', () => {
    expect(() => parseMarkdownArgs(['s.json', '--layout', 'grid'])).toThrow(/Invalid --layout value "grid"/)
    expect(() => parseMarkdownArgs(['s.json', '--sort', 'random'])).toThrow(/Invalid --sort value "random"/)
  })

  it('rejects a heading level outside 1-6', () => {
    expect(() => parseMarkdownArgs(['s.json', '--heading-level', '0'])).toThrow(/from 1 to 6/)
    expect(() => parseMarkdownArgs(['s.json', '--heading-level', '7'])).toThrow(/from 1 to 6/)
    expect(() => parseMarkdownArgs(['s.json', '--heading-level', 'two'])).toThrow(/from 1 to 6/)
  })

  it('rejects an unknown flag rather than dropping it', () => {
    expect(() => parseMarkdownArgs(['s.json', '--out', 'docs'])).toThrow(/Unknown flag "--out"/)
    expect(() => parseMarkdownArgs(['s.json', '--out=docs'])).toThrow(/Unknown flag "--out"/)
  })

  // `--out-dir --table` means --out-dir lost its value, which must fail rather
  // than write the pages into a directory literally named "--table".
  it('rejects a value flag that swallowed the next flag', () => {
    expect(() => parseMarkdownArgs(['s.json', '--out-dir', '--table'])).toThrow(/expects a value/)
    expect(() => parseMarkdownArgs(['s.json', '--out-dir'])).toThrow(/expects a value/)
  })

  it('names the switch when it is given a value', () => {
    expect(() => parseMarkdownArgs(['s.json', '--table=true'])).toThrow(/switch and takes no value/)
  })

  it('rejects a second positional', () => {
    expect(() => parseMarkdownArgs(['a.json', 'b.json'])).toThrow(/single schema path/)
  })

  it('reads --help', () => {
    expect(parseMarkdownArgs(['--help'])).toEqual({ help: true })
    expect(parseMarkdownArgs(['-h'])).toEqual({ help: true })
  })
})
