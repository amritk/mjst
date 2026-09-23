import { describe, expect, it } from 'vitest'
import Suite from 'yaml-test-suite'

import { parseAllDocuments, parseDocument } from './parse-document'
import type { YamlDocument } from './types'

/** Error codes of a document, in the order they were reported. */
const errorCodes = (doc: YamlDocument): string[] => doc.errors.map((e) => e.code)

/** Warning codes of a document, in the order they were reported. */
const warningCodes = (doc: YamlDocument): string[] => doc.warnings.map((w) => w.code)

/** Everything a caller can observe about a document, for comparing two of them. */
const summarize = (doc: YamlDocument | undefined): unknown =>
  doc === undefined
    ? { value: null, errors: [], warnings: [] }
    : {
        value: doc.toJS(),
        errors: doc.errors.map((e) => [e.code, e.start, e.end]),
        // `parseDocument` warns that it stopped at the first document, which is the
        // one diagnostic the stream reader has no reason to raise.
        warnings: doc.warnings.filter((w) => w.code !== 'MULTIPLE_DOCUMENTS').map((w) => [w.code, w.start, w.end]),
      }

describe('document-markers', () => {
  it('reads an indented "---" as a plain scalar', () => {
    const doc = parseDocument(' ---\n')
    expect(doc.toJS()).toBe('---')
    expect(errorCodes(doc)).toEqual([])
    expect(parseAllDocuments(' ---\n').map((d) => d.toJS())).toEqual(['---'])
  })

  it('folds an indented "---" into the root plain scalar above it', () => {
    // Only a marker at column 0 ends a document; one column in, it is text.
    expect(parseDocument('a\n ---\n').toJS()).toBe('a ---')
    const all = parseAllDocuments('a\n ---\n')
    expect(all.map((d) => d.toJS())).toEqual(['a ---'])
    expect(errorCodes(all[0] as YamlDocument)).toEqual([])
  })

  it('folds an indented "..." into a scalar written on the "---" line', () => {
    const doc = parseDocument('--- a\n  ...\n')
    expect(doc.toJS()).toBe('a ...')
    expect(errorCodes(doc)).toEqual([])
    expect(parseAllDocuments('--- a\n  ...\n').map((d) => d.toJS())).toEqual(['a ...'])
  })

  it('reads an indented "---" under a bare "---" as the document', () => {
    expect(parseDocument('---\n  ---\n').toJS()).toBe('---')
    expect(parseAllDocuments('---\n  ---\n').map((d) => d.toJS())).toEqual(['---'])
  })

  it('does not end a document at an indented "..." at its head', () => {
    // This used to come back as an empty document with no diagnostic from
    // `parseDocument`, while `parseAllDocuments` read the mapping below it.
    const doc = parseDocument('  ...\na: 1\n')
    expect(doc.toJS()).not.toBeNull()
    expect(summarize(doc)).toEqual(summarize(parseAllDocuments('  ...\na: 1\n')[0]))
  })

  it('reports an indented "---" after a root sequence as stray content', () => {
    const doc = parseDocument('  - a\n  ---\n')
    expect(doc.toJS()).toEqual(['a'])
    expect(errorCodes(doc)).toEqual(['UNEXPECTED_CONTENT'])
    expect(doc.errors[0]).toMatchObject({ start: 8, end: 11 })
    expect(warningCodes(doc)).toEqual([])
  })

  it('ends a root mapping at a "---" that carries a node', () => {
    // `--- b: 2` is the next document, not a key called `--- b`.
    const doc = parseDocument('a: 1\n--- b: 2\n')
    expect(doc.toJS()).toEqual({ a: 1 })
    expect(warningCodes(doc)).toEqual(['MULTIPLE_DOCUMENTS'])
    expect(parseAllDocuments('a: 1\n--- b: 2\n').map((d) => d.toJS())).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('ends a root mapping at a "..." marker', () => {
    const doc = parseDocument('a: 1\n... b: 2\n')
    expect(doc.toJS()).toEqual({ a: 1 })
    expect(errorCodes(doc)).toEqual(['UNEXPECTED_CONTENT'])
    expect(doc.errors[0]).toMatchObject({ start: 9, end: 13 })
  })

  it('warns when the next document is written on its "---" line', () => {
    const doc = parseDocument('a\n--- b\n')
    expect(doc.toJS()).toBe('a')
    expect(warningCodes(doc)).toEqual(['MULTIPLE_DOCUMENTS'])
    expect(doc.warnings[0]).toMatchObject({ start: 2, end: 5 })
  })

  it('does not warn about a bare trailing "---" or "..."', () => {
    expect(warningCodes(parseDocument('a: 1\n---\n'))).toEqual([])
    expect(warningCodes(parseDocument('a: 1\n...\n'))).toEqual([])
    expect(warningCodes(parseDocument('---\n---\n'))).toEqual([])
  })

  it('reports content after a "..." that ends the first document', () => {
    const doc = parseDocument('---\n... x\n')
    expect(doc.toJS()).toBeNull()
    expect(errorCodes(doc)).toEqual(['UNEXPECTED_CONTENT'])
    expect(doc.errors[0]).toMatchObject({ start: 8, end: 9 })
    expect(summarize(doc)).toEqual(summarize(parseAllDocuments('---\n... x\n')[0]))
  })

  it('stops at the second of two "---" markers', () => {
    // The first document is the empty one between the markers; the mapping
    // belongs to the second, which `parseDocument` does not read.
    const doc = parseDocument('---\n---\na: 1\n')
    expect(doc.toJS()).toBeNull()
    expect(errorCodes(doc)).toEqual([])
    expect(warningCodes(doc)).toEqual(['MULTIPLE_DOCUMENTS'])
    expect(doc.warnings[0]).toMatchObject({ start: 4, end: 7 })
  })

  it('reports a "%" line after "---" rather than dropping it', () => {
    // Once a document has started a `%` line is content, and `%` cannot open a
    // node. `parseDocument` used to read it as a directive and lose the key.
    const source = '--- \n%x: 1\nb: 2\n'
    const doc = parseDocument(source)
    expect(doc.toJS()).toEqual({ '%x': 1, b: 2 })
    expect(errorCodes(doc)).toEqual(['UNEXPECTED_DIRECTIVE'])
    expect(doc.errors[0]).toMatchObject({ start: 5, end: 8 })
    expect(warningCodes(doc)).toEqual([])
    expect(summarize(doc)).toEqual(summarize(parseAllDocuments(source)[0]))
  })

  it('requires a "---" after directives', () => {
    const doc = parseDocument('%YAML 1.2\nfoo: 1\n')
    expect(doc.toJS()).toEqual({ foo: 1 })
    expect(errorCodes(doc)).toEqual(['UNEXPECTED_DIRECTIVE'])
    expect(doc.errors[0]).toMatchObject({ start: 10, end: 10 })
    expect(errorCodes(parseDocument('%YAML 1.2\n---\nfoo: 1\n'))).toEqual([])
  })

  it('reports content after a leading "..." marker', () => {
    const doc = parseDocument('... x\n')
    expect(doc.toJS()).toBeNull()
    expect(errorCodes(doc)).toEqual(['UNEXPECTED_CONTENT'])
    expect(doc.errors[0]).toMatchObject({ start: 4, end: 5 })
  })

  it('reads the document after a leading "..." marker', () => {
    // A stream may open on a document suffix with no document in front of it
    // (`l-yaml-stream`), so the mapping is the first document, not a second one.
    const doc = parseDocument('...\na: 1\n')
    expect(doc.toJS()).toEqual({ a: 1 })
    expect(errorCodes(doc)).toEqual([])
    expect(warningCodes(doc)).toEqual([])
  })

  it('reads the first document the same way parseAllDocuments does', () => {
    const sources = [
      '',
      'a: 1\n',
      '﻿a: 1\n',
      '---\n',
      '--- a\n',
      '--- |\n  x\n',
      '---\na: 1\n',
      '--- # c\na: 1\n',
      '---\n---\na: 1\n',
      '--- \n%x: 1\nb: 2\n',
      '---\n%x\n',
      '%YAML 1.2\nfoo: 1\n',
      '%YAML 1.2\n---\nfoo: 1\n',
      '%YAML 1.2\n%YAML 1.2\n---\n',
      '%TAG !e! tag:example.com,2000:\n--- !e!x a\n',
      '%FOO\n',
      '...\n',
      '... x\n',
      '...\na: 1\n',
      '...\n---\na: 1\n',
      '---\n...\n',
      '---\n... x\n',
      ' ---\n',
      '  ...\na: 1\n',
      '--- a\n  ...\n',
      '---\n  ---\n',
      '--- - a\n',
      '--- ? a\n',
      '--- a: 1\n',
      '\ta: 1\n',
      '---\n\t- a\n',
      '\t[a]\n',
      '# c\n\n---\n# d\na\n',
    ]
    for (const source of sources) {
      expect(summarize(parseDocument(source)), JSON.stringify(source)).toEqual(summarize(parseAllDocuments(source)[0]))
    }
  })

  it('agrees with parseAllDocuments on every single-document suite case', () => {
    // The YAML test suite is a ready-made corpus of stream heads. Only streams
    // that hold at most one document are compared: when a second one follows,
    // stray content is legitimately reported on *that* document by the stream
    // reader and on the only one by `parseDocument`.
    const suite = Suite as unknown as { id: string; cases?: { yaml?: string }[] }[]
    const differing: string[] = []
    let compared = 0
    for (const file of suite) {
      for (const [i, testCase] of (file.cases ?? []).entries()) {
        if (typeof testCase.yaml !== 'string') continue
        const all = parseAllDocuments(testCase.yaml)
        if (all.length > 1) continue
        compared++
        // A projection may throw rather than return, so the message stands in for
        // the value. (`JSON.stringify` flattens the odd `Set`/`Map`, but only
        // the diagnostics and ordinary values are in question here.)
        const view = (doc: YamlDocument | undefined): unknown => {
          try {
            return summarize(doc)
          } catch (error) {
            return (error as Error).message
          }
        }
        if (JSON.stringify(view(parseDocument(testCase.yaml))) !== JSON.stringify(view(all[0]))) {
          differing.push(`${file.id}/${i}`)
        }
      }
    }
    expect(compared).toBeGreaterThan(250)
    expect(differing).toEqual([])
  })

  it('reports a block sequence opened on the "---" line', () => {
    for (const source of ['--- - a\n', '--- -\n']) {
      const doc = parseDocument(source)
      expect(errorCodes(doc), source).toEqual(['UNEXPECTED_CONTENT'])
      expect(doc.errors[0], source).toMatchObject({ start: 4 })
    }
    // The node is still read, so the value survives the report.
    expect(parseDocument('--- - a\n').toJS()).toEqual(['a'])
    expect(errorCodes(parseAllDocuments('--- - a\n')[0] as YamlDocument)).toEqual(['UNEXPECTED_CONTENT'])
  })

  it('reports an explicit key opened on the "---" line', () => {
    for (const source of ['--- ? a\n', '--- ?\n']) {
      const doc = parseDocument(source)
      expect(errorCodes(doc), source).toEqual(['UNEXPECTED_CONTENT'])
      expect(doc.errors[0], source).toMatchObject({ start: 4 })
    }
    expect(parseDocument('--- ? a\n').toJS()).toEqual({ a: null })
  })

  it('accepts scalars and flow collections on the "---" line', () => {
    for (const source of [
      '--- -1\n',
      '--- ?a\n',
      '--- [a, b]\n',
      '--- {a: 1}\n',
      '--- &a\n- a\n',
      '--- !!set\n? a\n',
    ]) {
      expect(errorCodes(parseDocument(source)), source).toEqual([])
    }
    expect(parseDocument('--- -1\n').toJS()).toBe(-1)
    expect(parseDocument('--- ?a\n').toJS()).toBe('?a')
  })

  it('reports a tab indenting a root block mapping', () => {
    for (const [source, start] of [
      ['\ta: 1\n', 0],
      ['# c\n\ta: 1\n', 4],
      ['---\n\ta: 1\n', 4],
      [' \ta: 1\n', 1],
      ['\t&a a: 1\n', 0],
      ['\t[a]: 1\n', 0],
    ] as const) {
      const doc = parseDocument(source)
      expect(errorCodes(doc), source).toEqual(['TAB_INDENT'])
      expect(doc.errors[0], source).toMatchObject({ start, end: source.indexOf('\t') + 1 })
      expect(errorCodes(parseAllDocuments(source)[0] as YamlDocument), source).toEqual(['TAB_INDENT'])
    }
    expect(parseDocument('\ta: 1\n').toJS()).toEqual({ a: 1 })
  })

  it('reports a tab indenting a root block sequence or explicit key', () => {
    expect(errorCodes(parseDocument('\t- a\n'))).toEqual(['TAB_INDENT'])
    expect(parseDocument('\t- a\n').toJS()).toEqual(['a'])
    expect(errorCodes(parseDocument('\t? a\n'))).toEqual(['TAB_INDENT'])
    // Each tab-indented line is reported once, the first by the root check and
    // the second by the sequence reading its next entry.
    const doc = parseDocument('\t- a\n\t- b\n')
    expect(errorCodes(doc)).toEqual(['TAB_INDENT', 'TAB_INDENT'])
    expect(doc.errors.map((e) => e.start)).toEqual([0, 5])
  })

  it('reports a tab indenting the root of a later document', () => {
    const docs = parseAllDocuments('a: 1\n---\n\tb: 2\n')
    expect(docs.map((d) => d.toJS())).toEqual([{ a: 1 }, { b: 2 }])
    expect(errorCodes(docs[0] as YamlDocument)).toEqual([])
    expect(errorCodes(docs[1] as YamlDocument)).toEqual(['TAB_INDENT'])
  })

  it('accepts a tab before a root flow collection, scalar, or properties line', () => {
    // A tab is separation, not indentation, in front of anything that does not
    // open a block collection on that line.
    for (const source of ['\t[a]\n', '\t{}\n', "\t'~'\n", '\t"a"\n', '\ta\n', '\t&x\n- a\n', '\t# c\na: 1\n']) {
      expect(errorCodes(parseDocument(source)), JSON.stringify(source)).toEqual([])
      expect(errorCodes(parseAllDocuments(source)[0] as YamlDocument), JSON.stringify(source)).toEqual([])
    }
  })

  it('still splits documents at column-0 markers', () => {
    const docs = parseAllDocuments('a: 1\n---\nb: 2\n...\n---\n- c\n')
    expect(docs.map((d) => d.toJS())).toEqual([{ a: 1 }, { b: 2 }, ['c']])
    for (const doc of docs) expect(errorCodes(doc)).toEqual([])
    const first = parseDocument('a: 1\n---\nb: 2\n')
    expect(first.toJS()).toEqual({ a: 1 })
    expect(warningCodes(first)).toEqual(['MULTIPLE_DOCUMENTS'])
  })
})
