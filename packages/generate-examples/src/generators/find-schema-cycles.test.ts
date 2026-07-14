import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { findSchemaCycles } from './find-schema-cycles'

/** Convenience: the sibling filenames a file must reference lazily, sorted. */
const lazyOf = (cycles: ReadonlyMap<string, ReadonlySet<string>>, filename: string): string[] =>
  [...(cycles.get(filename) ?? [])].sort()

describe('findSchemaCycles', () => {
  it('flags both files of a two-file mutual cycle', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { root: { $ref: '#/$defs/ping' } },
      $defs: {
        ping: { type: 'object', properties: { pong: { $ref: '#/$defs/pong' } } },
        pong: { type: 'object', properties: { ping: { $ref: '#/$defs/ping' } } },
      },
    }
    const cycles = findSchemaCycles(schema, 'Doc')

    expect(lazyOf(cycles, 'ping')).toEqual(['pong'])
    expect(lazyOf(cycles, 'pong')).toEqual(['ping'])
    // The root only points into the cycle; it is not itself a member.
    expect(cycles.has('doc')).toBe(false)
  })

  it('groups a three-file cycle into one component', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { a: { $ref: '#/$defs/a' } },
      $defs: {
        a: { type: 'object', properties: { b: { $ref: '#/$defs/b' } } },
        b: { type: 'object', properties: { c: { $ref: '#/$defs/c' } } },
        c: { type: 'object', properties: { a: { $ref: '#/$defs/a' } } },
      },
    }
    const cycles = findSchemaCycles(schema, 'Doc')

    expect(lazyOf(cycles, 'a')).toEqual(['b', 'c'])
    expect(lazyOf(cycles, 'b')).toEqual(['a', 'c'])
    expect(lazyOf(cycles, 'c')).toEqual(['a', 'b'])
  })

  it('ignores pure self-references (handled by fc.letrec, not a cross-file cycle)', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { node: { $ref: '#/$defs/node' } },
      $defs: {
        node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } },
      },
    }
    expect(findSchemaCycles(schema, 'Doc').size).toBe(0)
  })

  it('returns nothing for an acyclic chain', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { a: { $ref: '#/$defs/a' } },
      $defs: {
        a: { type: 'object', properties: { b: { $ref: '#/$defs/b' } } },
        b: { type: 'object', properties: { name: { type: 'string' } } },
      },
    }
    expect(findSchemaCycles(schema, 'Doc').size).toBe(0)
  })
})
