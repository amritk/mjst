import { describe, expect, it } from 'vitest'
import {
  ARRAY_ITEM,
  childEntries,
  childSchema,
  childSources,
  formatPath,
  MAP_KEY,
  MAP_KEY_PLACEHOLDER,
  sortEntries,
} from '#reference/child-entries'
import type { DocEntry } from '#types/render'

const names = (entries: readonly DocEntry[]): readonly string[] => entries.map((entry) => entry.name)

const entry = (name: string, prop: Record<string, unknown> = {}): DocEntry => ({
  name,
  prop,
  path: [name],
  required: false,
})

describe('child-entries', () => {
  it('reads children straight off an object', () => {
    const prop = { type: 'object', properties: { a: { type: 'string' } } }
    expect(childSchema(prop)).toEqual({ node: prop, hop: undefined })
  })

  // `pagination: [{ name, type }]` documents `name` and `type`, not the array.
  it('reads children off the item schema of an array', () => {
    const items = { type: 'object', properties: { name: { type: 'string' } } }
    expect(childSchema({ type: 'array', items })).toEqual({ node: items, hop: ARRAY_ITEM })
  })

  it('reads children off additionalProperties for a map-like object', () => {
    const values = { type: 'object', properties: { url: { type: 'string' } } }
    expect(childSchema({ type: 'object', additionalProperties: values })).toEqual({ node: values, hop: MAP_KEY })
  })

  // Several sources can describe one node's children; `childSchema` is the
  // first of them, which is what a root falls back to when it has no names.
  it('returns every source, the node own properties first', () => {
    const items = { type: 'object', properties: { fromItems: {} } }
    const prop = { type: 'array', properties: { own: {} }, items }
    expect(childSources(prop)).toEqual([
      { node: prop, hop: undefined },
      { node: items, hop: ARRAY_ITEM },
    ])
    expect(childSchema(prop)).toEqual({ node: prop, hop: undefined })
  })

  it('reads no children from a scalar', () => {
    expect(childEntries({ type: 'string' }, ['a'], 'schema')).toEqual([])
  })

  it('marks each child required against its own parent', () => {
    const prop = {
      type: 'object',
      required: ['host'],
      properties: { host: { type: 'string' }, port: { type: 'number' } },
    }
    expect(childEntries(prop, ['server'], 'schema')).toEqual([
      { name: 'host', prop: { type: 'string' }, path: ['server', 'host'], required: true },
      { name: 'port', prop: { type: 'number' }, path: ['server', 'port'], required: false },
    ])
  })

  it('records the array hop in a child path', () => {
    const prop = { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } }
    expect(childEntries(prop, ['pagination'], 'schema')[0]?.path).toEqual(['pagination', ARRAY_ITEM, 'name'])
  })

  // The error messages and the derived examples both name the map hop, and a
  // reader who sees `<name>` in one should see it in the other.
  it('formats the array and map hops the way an example spells them', () => {
    expect(formatPath(['a', ARRAY_ITEM, 'b'])).toBe('a.[].b')
    expect(formatPath(['a', MAP_KEY, 'b'])).toBe(`a.${MAP_KEY_PLACEHOLDER}.b`)
  })

  it('drops hidden children', () => {
    const prop = {
      type: 'object',
      properties: { shown: { type: 'string' }, secret: { type: 'string', 'x-doc': { hidden: true } } },
    }
    expect(names(childEntries(prop, [], 'schema'))).toEqual(['shown'])
  })

  it('keeps schema order by default', () => {
    expect(names(sortEntries([entry('b'), entry('a')], 'schema'))).toEqual(['b', 'a'])
  })

  it('sorts by name when asked', () => {
    expect(names(sortEntries([entry('b'), entry('a')], 'alphabetical'))).toEqual(['a', 'b'])
  })

  // Case-sensitive sorting files every capitalised name ahead of every
  // lowercase one, so `Timeout` would jump the whole list instead of sitting
  // next to `timeoutMs`. The fixture has to be a pair the two comparators
  // order differently, or the test proves nothing.
  it('sorts case-insensitively', () => {
    const sorted = sortEntries([entry('apple'), entry('Banana')], 'alphabetical')
    expect(names(sorted)).toEqual(['apple', 'Banana'])
  })

  it('breaks a case-only tie in favour of the capitalised name', () => {
    expect(names(sortEntries([entry('foo'), entry('Foo')], 'alphabetical'))).toEqual(['Foo', 'foo'])
  })

  it('puts x-doc.order ahead of the sort mode', () => {
    const entries = [entry('c'), entry('a'), entry('b', { 'x-doc': { order: 1 } })]
    expect(names(sortEntries(entries, 'alphabetical'))).toEqual(['b', 'a', 'c'])
  })

  it('keeps ordered properties in their declared order', () => {
    const entries = [entry('second', { 'x-doc': { order: 2 } }), entry('first', { 'x-doc': { order: 1 } })]
    expect(names(sortEntries(entries, 'schema'))).toEqual(['first', 'second'])
  })

  it('keeps unordered properties stable behind the ordered ones', () => {
    const entries = [entry('z'), entry('y'), entry('x', { 'x-doc': { order: 5 } })]
    expect(names(sortEntries(entries, 'schema'))).toEqual(['x', 'z', 'y'])
  })
})
