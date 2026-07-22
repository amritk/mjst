import { describe, expect, it } from 'vitest'

import { createDocument } from '../core'
import { DiagnosticSeverity, type IDiagnostic } from '../core/types'
import { applyFixes } from './apply'
import { createFixPlugin } from './plugin'
import type { FixerRegistry } from './types'

const ZERO = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

const diagnostic = (code: string, path: (string | number)[]): IDiagnostic => ({
  code,
  message: code,
  path,
  severity: DiagnosticSeverity.Warning,
  range: ZERO,
})

const fixers: FixerRegistry = {
  'strip-slash': {
    fix: ({ diagnostic: d, data }) => {
      const value = (data as Record<string, unknown>)[d.path[0] as string]
      if (typeof value !== 'string') return undefined
      return { op: 'setValue', path: d.path, value: value.replace(/\/$/, '') }
    },
  },
  'reorder-tags': {
    fix: () => ({ op: 'reorderArray', path: ['tags'], order: [1, 0] }),
  },
  // Always produces an edit whose path does not exist, so the edit no-ops.
  phantom: {
    fix: ({ diagnostic: d }) => ({ op: 'removeProperty', path: d.path }),
  },
  unsafe: {
    safe: false,
    fix: ({ diagnostic: d }) => ({ op: 'removeProperty', path: d.path }),
  },
  // Alphabetize the tags array by name (mirrors openapi-tags-alphabetical).
  'sort-tags': {
    fix: ({ data }) => {
      const tags = (data as { tags: string[] }).tags
      const order = tags.map((_, index) => index).sort((a, b) => String(tags[a]).localeCompare(String(tags[b])))
      if (order.every((value, index) => value === index)) return undefined
      return { op: 'reorderArray', path: ['tags'], order }
    },
  },
  // Remove later duplicate tags, deriving indices from the current data each pass
  // (mirrors openapi-tags-uniqueness).
  'dedupe-tags': {
    fix: ({ data }) => {
      const tags = (data as { tags: string[] }).tags
      const seen = new Set<string>()
      const duplicates: number[] = []
      tags.forEach((tag, index) => {
        if (seen.has(tag)) duplicates.push(index)
        else seen.add(tag)
      })
      if (duplicates.length === 0) return undefined
      return { op: 'removeItems', path: ['tags'], indices: duplicates }
    },
  },
  // Two edits: one lands, one targets a missing path and no-ops.
  partial: {
    fix: () => [
      { op: 'setValue', path: ['a'], value: 2 },
      { op: 'setValue', path: ['missing'], value: 3 },
    ],
  },
}

describe('apply', () => {
  it('applies a fixer for a matching finding', () => {
    const input = 'host: api.example.com/\n'
    const data = { host: 'api.example.com/' }
    const result = applyFixes(input, 'yaml', data, [diagnostic('strip-slash', ['host'])], fixers)
    expect(result.changed).toBe(true)
    expect(result.output).toBe('host: api.example.com\n')
    expect(result.applied).toEqual([{ code: 'strip-slash', path: ['host'] }])
  })

  it('de-duplicates identical edits from multiple findings', () => {
    const input = 'tags:\n  - name: zebra\n  - name: apple\n'
    const data = { tags: [{ name: 'zebra' }, { name: 'apple' }] }
    // Two findings on the same array both request the same reorder.
    const result = applyFixes(
      input,
      'yaml',
      data,
      [diagnostic('reorder-tags', ['tags', 1]), diagnostic('reorder-tags', ['tags', 1])],
      fixers,
    )
    expect(result.output).toBe('tags:\n  - name: apple\n  - name: zebra\n')
    expect(result.applied).toHaveLength(2)
  })

  it('does not report a finding whose edit no-ops as applied', () => {
    const input = 'a: 1\n'
    // The fixer matches and produces an edit, but the edit targets a path that is
    // not present, so nothing changes and the finding must not count as applied.
    const result = applyFixes(input, 'yaml', { a: 1 }, [diagnostic('phantom', ['missing'])], fixers)
    expect(result.changed).toBe(false)
    expect(result.applied).toEqual([])
  })

  it('leaves the document untouched when no fixer matches', () => {
    const input = 'a: 1\n'
    const result = applyFixes(input, 'yaml', { a: 1 }, [diagnostic('unknown', ['a'])], fixers)
    expect(result.changed).toBe(false)
    expect(result.output).toBe(input)
  })

  it('skips unsafe fixers unless safeOnly is disabled', () => {
    const input = 'a: 1\nb: 2\n'
    const findings = [diagnostic('unsafe', ['b'])]
    expect(applyFixes(input, 'yaml', { a: 1, b: 2 }, findings, fixers).changed).toBe(false)
    const forced = applyFixes(input, 'yaml', { a: 1, b: 2 }, findings, fixers, { safeOnly: false })
    expect(forced.output).toBe('a: 1\n')
  })

  it('exposes the fix as a Linter plugin returning output and data', () => {
    const input = 'host: api.example.com/\n'
    const document = createDocument(input)
    const plugin = createFixPlugin(fixers)
    const result = plugin.afterLint?.([diagnostic('strip-slash', ['host'])], {
      input,
      format: 'yaml',
      document,
      resolved: document.data,
      ruleset: {} as never,
    })
    expect(result?.output).toBe('host: api.example.com\n')
    expect(result?.data).toEqual({ applied: [{ code: 'strip-slash', path: ['host'] }] })
  })

  // H4: two ops reshaping the same array in one batch would use stale indices, so
  // the second is deferred to the next pass, which re-derives indices from fresh
  // data. Here reorder + dedupe on `[z, a, a]` must end at `[a, z]`, not delete
  // the unique tag.
  it('defers a second op that reshapes an array an earlier op already changed', () => {
    const input = 'tags: [z, a, a]\n'
    const findings = [diagnostic('sort-tags', ['tags', 0]), diagnostic('dedupe-tags', ['tags', 0])]

    // Pass one: only the reorder lands; the dedupe is deferred (and unreported).
    const pass1 = applyFixes(input, 'yaml', { tags: ['z', 'a', 'a'] }, findings, fixers)
    expect(pass1.output).toBe('tags: [a, a, z]\n')
    expect(pass1.applied).toEqual([{ code: 'sort-tags', path: ['tags', 0] }])

    // Pass two re-derives from the reordered data, so the dedupe removes the real
    // duplicate and keeps the unique tag.
    const pass2 = applyFixes(pass1.output, 'yaml', { tags: ['a', 'a', 'z'] }, findings, fixers)
    expect(pass2.output).toBe('tags: [a, z]\n')
    expect(pass2.applied).toEqual([{ code: 'dedupe-tags', path: ['tags', 0] }])
  })

  // L6: a multi-op fixer counts as applied only when every one of its edits lands;
  // a partially-applied fixer is left unreported so the fixpoint loop retries it.
  it('does not report a fixer as applied when one of its edits no-ops', () => {
    const result = applyFixes('a: 1\n', 'yaml', { a: 1 }, [diagnostic('partial', ['a'])], fixers)
    expect(result.output).toBe('a: 2\n')
    expect(result.changed).toBe(true)
    expect(result.applied).toEqual([])
  })

  it('returns nothing from the plugin when there is no change', () => {
    const input = 'a: 1\n'
    const document = createDocument(input)
    const plugin = createFixPlugin(fixers)
    const result = plugin.afterLint?.([diagnostic('unknown', ['a'])], {
      input,
      format: 'yaml',
      document,
      resolved: document.data,
      ruleset: {} as never,
    })
    expect(result).toBeUndefined()
  })
})
