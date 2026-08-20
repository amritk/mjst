import { describe, expect, it } from 'vitest'

import { graftExternalSchemas } from './graft-external-schemas'
import { normalizeRefScopes } from './normalize-ref-scopes'

/** What a caller actually cares about: the pointer a cross-document ref ends up as. */
const normalizedRootRef = (root: Record<string, unknown>, schemas: Record<string, unknown>): unknown =>
  normalizeRefScopes(graftExternalSchemas(root, schemas).document)['$ref']

describe('graft-external-schemas', () => {
  // Identity, not a copy: the no-registry call is the overwhelmingly common one
  // and every downstream cache is keyed on the object.
  it('returns the root unchanged, by identity, when nothing is registered', () => {
    const root = { $ref: 'integer.json' }

    expect(graftExternalSchemas(root, {}).document).toBe(root)
  })

  it('gives a document with no $id the URI it was registered under', () => {
    const grafted = graftExternalSchemas({}, { 'http://localhost:1234/integer.json': { type: 'integer' } }).document

    expect((grafted['$defs'] as Record<string, unknown>)['integer']).toEqual({
      $id: 'http://localhost:1234/integer.json',
      type: 'integer',
    })
  })

  it('embeds a document whose $id already matches verbatim', () => {
    const document = { $id: 'http://localhost:1234/a.json', type: 'string' }

    const grafted = graftExternalSchemas({}, { 'http://localhost:1234/a.json': document }).document

    expect((grafted['$defs'] as Record<string, unknown>)['a']).toBe(document)
  })

  it('makes a registered URI resolvable as a plain pointer', () => {
    const ref = normalizedRootRef(
      { $ref: 'http://localhost:1234/integer.json' },
      { 'http://localhost:1234/integer.json': { type: 'integer' } },
    )

    expect(ref).toBe('#/$defs/integer')
  })

  // The retrieval URI is a base URI, so a relative ref *inside* a registered
  // document resolves against where it was fetched from — not against the root.
  it('resolves a relative ref inside a registered document against its own URI', () => {
    const grafted = graftExternalSchemas(
      { $ref: 'http://localhost:1234/nested/foo.json' },
      {
        'http://localhost:1234/nested/foo.json': { properties: { foo: { $ref: 'string.json' } } },
        'http://localhost:1234/nested/string.json': { type: 'string' },
      },
    ).document
    const normalized = normalizeRefScopes(grafted) as Record<string, Record<string, Record<string, unknown>>>

    expect(normalized['$defs']?.['nested-foo']?.['properties']).toEqual({ foo: { $ref: '#/$defs/nested-string' } })
  })

  // `$ref: "#"` inside a registered document means *that document's* root, which
  // is the whole point of it being an embedded resource rather than inlined.
  it('points a root ref inside a registered document at that document', () => {
    const grafted = graftExternalSchemas(
      { $ref: 'http://localhost:1234/name-defs.json' },
      {
        'http://localhost:1234/name-defs.json': {
          type: 'string',
          $defs: { orNull: { anyOf: [{ type: 'null' }, { $ref: '#' }] } },
        },
      },
    ).document
    const normalized = normalizeRefScopes(grafted) as Record<string, Record<string, Record<string, unknown>>>
    const anyOf = (normalized['$defs']?.['name-defs']?.['$defs'] as Record<string, Record<string, unknown[]>>)['orNull']

    expect(anyOf?.['anyOf']?.[1]).toEqual({ $ref: '#/$defs/name-defs' })
  })

  it('resolves an anchor declared in a registered document', () => {
    const ref = normalizedRootRef(
      { $ref: 'http://localhost:1234/ids.json#foo' },
      { 'http://localhost:1234/ids.json': { $defs: { a: { $anchor: 'foo', type: 'integer' } } } },
    )

    expect(ref).toBe('#/$defs/ids/$defs/a')
  })

  it('resolves a ref from one registered document into another', () => {
    const grafted = graftExternalSchemas(
      { $ref: 'http://localhost:1234/a.json' },
      {
        'http://localhost:1234/a.json': { $ref: 'b.json' },
        'http://localhost:1234/b.json': { type: 'integer' },
      },
    ).document
    const normalized = normalizeRefScopes(grafted) as Record<string, Record<string, Record<string, unknown>>>

    expect(normalized['$defs']?.['a']?.['$ref']).toBe('#/$defs/b')
  })

  // A document fetched from one URI but declaring another has to answer to both:
  // its own `$id` for anything that references it that way, and the retrieval URI
  // for the caller who registered it.
  it('keeps both URIs live when a document $id disagrees with its retrieval URI', () => {
    const grafted = graftExternalSchemas(
      { $ref: 'http://localhost:1234/fetched.json' },
      {
        'http://localhost:1234/fetched.json': {
          $id: 'http://localhost:1234/declared.json',
          $defs: { bar: { type: 'string' } },
          $ref: '#/$defs/bar',
        },
      },
    ).document
    const normalized = normalizeRefScopes(grafted) as Record<string, Record<string, Record<string, unknown>>>

    expect(normalized['$ref']).toBe('#/$defs/fetched-retrieved')
    expect(normalized['$defs']?.['fetched-retrieved']?.['$ref']).toBe('#/$defs/fetched')
  })

  it('registers a URN $id alongside the URL it was retrieved from', () => {
    const ref = normalizedRootRef(
      { $ref: 'urn:uuid:deadbeef-0000-0000-0000-000000000000' },
      {
        'http://localhost:1234/urn.json': {
          $id: 'urn:uuid:deadbeef-0000-0000-0000-000000000000',
          type: 'string',
        },
      },
    )

    expect(ref).toBe('#/$defs/urn')
  })

  it('leaves the root document declarations in place', () => {
    const grafted = graftExternalSchemas(
      { $defs: { own: { type: 'boolean' } } },
      { 'http://localhost:1234/other.json': { type: 'integer' } },
    ).document

    expect(Object.keys(grafted['$defs'] as Record<string, unknown>)).toEqual(['own', 'other'])
  })

  it('embeds a boolean document as its object equivalent', () => {
    const grafted = graftExternalSchemas(
      {},
      { 'http://localhost:1234/yes.json': true, 'http://localhost:1234/no.json': false },
    ).document
    const defs = grafted['$defs'] as Record<string, unknown>

    expect(defs['yes']).toEqual({ $id: 'http://localhost:1234/yes.json' })
    expect(defs['no']).toEqual({ $id: 'http://localhost:1234/no.json', not: {} })
  })

  it('ignores a registered value that is not a schema', () => {
    const root = { type: 'string' }

    expect(graftExternalSchemas(root, { 'http://localhost:1234/nope.json': 'not a schema' }).document).toBe(root)
  })

  it('reports the definition names it introduced', () => {
    const { names } = graftExternalSchemas(
      { $defs: { own: {} } },
      { 'http://localhost:1234/a.json': {}, 'http://localhost:1234/b.json': {} },
    )

    expect([...names]).toEqual(['a', 'b'])
  })

  // Silently picking a winner would mistype every reference to the loser, which
  // is the worst outcome available. Two hosts serving the same path collide,
  // because the name is derived from the path.
  it('refuses two registered URIs that reduce to one definition name', () => {
    expect(() =>
      graftExternalSchemas(
        {},
        { 'http://localhost:1234/thing.json': { type: 'string' }, 'http://example.com/thing.json': {} },
      ),
    ).toThrow(/both reduce to the definition name/)
  })

  it('refuses a registered URI that collides with a root definition', () => {
    expect(() =>
      graftExternalSchemas({ $defs: { thing: { type: 'string' } } }, { 'http://localhost:1234/thing.json': {} }),
    ).toThrow(/the root document already declares/)
  })

  // A plain `defs[name] = …` on this name runs the prototype setter: the
  // document vanishes from $defs while `names` still reports it, and the map
  // starts inheriting the document's own keywords.
  it('embeds a document whose URI reduces to the definition name __proto__', () => {
    const { document, names } = graftExternalSchemas(
      { $ref: 'https://example.com/__proto__.json' },
      { 'https://example.com/__proto__.json': { type: 'object' } },
    )

    const defs = document['$defs'] as Record<string, unknown>
    expect([...names]).toEqual(['__proto__'])
    expect(Object.hasOwn(defs, '__proto__')).toBe(true)
    expect(Object.keys(defs)).toEqual(['__proto__'])
    expect((defs as Record<string, never>)['type']).toBeUndefined()
  })
})
