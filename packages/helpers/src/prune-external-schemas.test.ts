import { describe, expect, it } from 'vitest'

import { pruneExternalSchemas } from './prune-external-schemas'

/** The `$defs` names left after a prune. */
const keptDefs = (document: Record<string, unknown>): string[] =>
  Object.keys(document['$defs'] as Record<string, unknown>)

describe('prune-external-schemas', () => {
  it('returns the document by identity when nothing was registered', () => {
    const document = { $defs: { a: {} } }

    expect(pruneExternalSchemas(document, new Set())).toBe(document)
  })

  it('returns the document by identity when every registered document is used', () => {
    const document = { $ref: '#/$defs/remote', $defs: { remote: { type: 'string' } } }

    expect(pruneExternalSchemas(document, new Set(['remote']))).toBe(document)
  })

  it('drops a registered document nothing references', () => {
    const document = {
      $ref: '#/$defs/used',
      $defs: { used: { type: 'string' }, unused: { type: 'integer' } },
    }

    expect(keptDefs(pruneExternalSchemas(document, new Set(['used', 'unused'])))).toEqual(['used'])
  })

  it('keeps the definitions the author wrote, referenced or not', () => {
    const document = { $defs: { own: { type: 'string' }, unused: { type: 'integer' } } }

    expect(keptDefs(pruneExternalSchemas(document, new Set(['unused'])))).toEqual(['own'])
  })

  // A registered document reached only through another registered document is
  // still reached — the search follows refs out of everything it keeps.
  it('keeps a registered document referenced by another registered document', () => {
    const document = {
      $ref: '#/$defs/a',
      $defs: { a: { $ref: '#/$defs/b' }, b: { $ref: '#/$defs/c' }, c: { type: 'string' }, d: {} },
    }

    expect(keptDefs(pruneExternalSchemas(document, new Set(['a', 'b', 'c', 'd'])))).toEqual(['a', 'b', 'c'])
  })

  it('does not let an unused registered document vouch for itself', () => {
    const document = {
      type: 'string',
      $defs: { a: { $ref: '#/$defs/b' }, b: { type: 'integer' } },
    }

    expect(keptDefs(pruneExternalSchemas(document, new Set(['a', 'b'])))).toEqual([])
  })

  // A document reached only by late binding has to survive, or the ref that
  // needs it would resolve to nothing.
  it('keeps a registered document a $dynamicRef binds to', () => {
    const document = {
      items: { $dynamicRef: '#node' },
      $defs: { tree: { $dynamicAnchor: 'node', type: 'object' }, other: {} },
    }

    expect(keptDefs(pruneExternalSchemas(document, new Set(['tree', 'other'])))).toEqual(['tree'])
  })

  it('keeps a registered document a pointer-form $dynamicRef names', () => {
    const document = { items: { $dynamicRef: '#/$defs/tree' }, $defs: { tree: { type: 'object' }, other: {} } }

    expect(keptDefs(pruneExternalSchemas(document, new Set(['tree', 'other'])))).toEqual(['tree'])
  })

  it('follows a ref into a nested part of a registered document', () => {
    const document = {
      $ref: '#/$defs/remote/$defs/inner',
      $defs: { remote: { $defs: { inner: { type: 'string' } } }, other: {} },
    }

    expect(keptDefs(pruneExternalSchemas(document, new Set(['remote', 'other'])))).toEqual(['remote'])
  })

  it('matches a definition name that carries a pointer escape', () => {
    const document = { $ref: '#/$defs/a~1b', $defs: { 'a/b': { type: 'string' }, other: {} } }

    expect(keptDefs(pruneExternalSchemas(document, new Set(['a/b', 'other'])))).toEqual(['a/b'])
  })

  // Rebuilding the map with a plain assignment drops a definition the author
  // wrote — it is not even one of the registered ones.
  it('keeps an authored definition named __proto__ while pruning', () => {
    const document = JSON.parse(
      '{"$ref":"#/$defs/keep","$defs":{"keep":{"type":"string"},"__proto__":{"type":"number"},"unused":{}}}',
    ) as Record<string, unknown>

    const defs = pruneExternalSchemas(document, new Set(['unused']))['$defs'] as Record<string, unknown>

    expect(Object.keys(defs).sort()).toEqual(['__proto__', 'keep'])
    expect(Object.hasOwn(defs, '__proto__')).toBe(true)
  })
})
