import { describe, expect, it } from 'vitest'
import { asExamples, readDescription, readDocMeta } from '#helpers/read-doc-meta'

describe('read-doc-meta', () => {
  it('reads an empty meta from a node without x-doc', () => {
    expect(readDocMeta({ type: 'string' })).toEqual({
      hidden: false,
      heading: true,
      examples: [],
      notes: [],
      footers: [],
    })
  })

  it('reads the placement members', () => {
    const meta = readDocMeta({ 'x-doc': { page: 'typescript', section: 'output', order: 2, title: 'Target' } })
    expect(meta.page).toBe('typescript')
    expect(meta.section).toBe('output')
    expect(meta.order).toBe(2)
    expect(meta.title).toBe('Target')
  })

  it('accepts a bare code string as an example', () => {
    expect(readDocMeta({ 'x-doc': { example: 'const a = 1' } }).examples).toEqual([{ code: 'const a = 1' }])
  })

  it('accepts a list of examples with captions and languages', () => {
    const meta = readDocMeta({
      'x-doc': {
        examples: [
          { code: 'a', caption: 'First' },
          { code: 'b', language: 'bash' },
        ],
      },
    })
    expect(meta.examples).toEqual([
      { code: 'a', caption: 'First' },
      { code: 'b', language: 'bash' },
    ])
  })

  // A JSON schema cannot hold a code block without escaping it into a string,
  // so an example may name the value instead and let the renderer serialize it.
  it('accepts an example given as a value', () => {
    expect(readDocMeta({ 'x-doc': { example: { value: { darkMode: true } } } }).examples).toEqual([
      { value: { darkMode: true } },
    ])
  })

  it('keeps a null example value, which is a value like any other', () => {
    expect(readDocMeta({ 'x-doc': { example: { value: null } } }).examples).toEqual([{ value: null }])
  })

  it('merges the singular and plural spellings rather than picking one', () => {
    const meta = readDocMeta({ 'x-doc': { example: 'one', examples: ['two'], note: 'a', notes: ['b'] } })
    expect(meta.examples).toEqual([{ code: 'one' }, { code: 'two' }])
    expect(meta.notes).toEqual(['a', 'b'])
  })

  it('reads footers, which render after the examples', () => {
    expect(readDocMeta({ 'x-doc': { footer: 'Afterwards…' } }).footers).toEqual(['Afterwards…'])
  })

  it('drops an example that carries neither code nor value', () => {
    expect(readDocMeta({ 'x-doc': { examples: [{ caption: 'Nothing here' }, '', 5] } }).examples).toEqual([])
  })

  it('reads the hidden and heading switches', () => {
    expect(readDocMeta({ 'x-doc': { hidden: true } }).hidden).toBe(true)
    expect(readDocMeta({ 'x-doc': { heading: false } }).heading).toBe(false)
    expect(readDocMeta({ 'x-doc': { heading: true } }).heading).toBe(true)
  })

  // The schema is parsed JSON, not validated input: a mistyped member should
  // leave the default in place rather than throw halfway through a docs build.
  it('ignores members of the wrong type', () => {
    const meta = readDocMeta({
      'x-doc': { page: 5, section: null, layout: 'grid', sort: 'random', order: 'first', hidden: 'yes' },
    })
    expect(meta).toEqual({ hidden: false, heading: true, examples: [], notes: [], footers: [] })
  })

  it('ignores a non-object x-doc', () => {
    expect(readDocMeta({ 'x-doc': 'yes' }).hidden).toBe(false)
    expect(readDocMeta(null).hidden).toBe(false)
  })

  // A node that only passes a page down to its children would otherwise print
  // its parent's sentence a second time.
  it('honours an empty x-doc description as a deliberate silence', () => {
    expect(readDescription({ description: 'From the schema', 'x-doc': { description: '' } })).toBe('')
  })

  it('prefers an x-doc description over the schema keyword', () => {
    expect(readDescription({ description: 'From the schema', 'x-doc': { description: 'For the docs' } })).toBe(
      'For the docs',
    )
    expect(readDescription({ description: 'From the schema' })).toBe('From the schema')
    expect(readDescription({ description: 42 })).toBe('')
  })

  // Every member of the fixed sets, because a property opting *back out* of a
  // page-level setting is the only way one of them shows: a page that asked
  // for `table` and a property that asks for `headings` again.
  it('reads every layout and sort name it accepts', () => {
    for (const layout of ['headings', 'table', 'none'] as const) {
      expect(readDocMeta({ 'x-doc': { layout } }).layout, layout).toBe(layout)
    }
    for (const sort of ['schema', 'alphabetical'] as const) {
      expect(readDocMeta({ 'x-doc': { sort } }).sort, sort).toBe(sort)
    }
    const unknown = readDocMeta({ 'x-doc': { layout: 'grid', sort: 'random' } })
    expect(unknown.layout).toBeUndefined()
    expect(unknown.sort).toBeUndefined()
  })

  // Both spellings, merged rather than one winning — the same rule notes and
  // examples follow, so a schema that grows a second footer need not rewrite
  // the first.
  it('merges both spellings of the footer keyword, singular first', () => {
    expect(readDocMeta({ 'x-doc': { footer: 'One.', footers: ['Two.', 'Three.'] } }).footers).toEqual([
      'One.',
      'Two.',
      'Three.',
    ])
  })

  // An example's `value` has to be the example's own: an inherited one is the
  // prototype's, and JSON cannot produce it.
  it('reads only an own value from an example', () => {
    const inherited = Object.create({ value: 'from the prototype' }) as Record<string, unknown>
    inherited['caption'] = 'A caption.'
    expect(asExamples([inherited])).toEqual([])
  })
})
