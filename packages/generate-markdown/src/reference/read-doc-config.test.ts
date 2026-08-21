import { describe, expect, it } from 'vitest'
import { INDEX_PAGE_ID, readDocConfig } from '#reference/read-doc-config'

describe('read-doc-config', () => {
  it('defaults to one JSON page called index.md', () => {
    const config = readDocConfig({})
    expect(config.language).toBe('json')
    expect(config.layout).toBe('headings')
    expect(config.sort).toBe('schema')
    expect(config.headingLevel).toBe(1)
    expect(config.pages).toEqual([{ id: INDEX_PAGE_ID, file: 'index.md', examples: [] }])
  })

  it('takes the index page title and prose from the schema', () => {
    const config = readDocConfig({ title: 'Configuration', description: 'Everything you can pass.' })
    expect(config.pages[0]?.title).toBe('Configuration')
    expect(config.pages[0]?.description).toBe('Everything you can pass.')
  })

  it('reads the defaults the schema declares', () => {
    const config = readDocConfig({
      'x-doc': { file: 'configuration.md', language: 'javascript', layout: 'table', sort: 'alphabetical' },
    })
    expect(config.pages[0]?.file).toBe('configuration.md')
    expect(config.language).toBe('javascript')
    expect(config.layout).toBe('table')
    expect(config.sort).toBe('alphabetical')
  })

  // The schema owns the content; the caller owns where it lands.
  it('lets the caller override the schema', () => {
    const schema = { title: 'From schema', 'x-doc': { file: 'a.md', language: 'javascript' } }
    const config = readDocConfig(schema, { file: 'b.md', title: 'From caller', language: 'yaml', headingLevel: 3 })
    expect(config.pages[0]).toEqual({ id: INDEX_PAGE_ID, file: 'b.md', title: 'From caller', examples: [] })
    expect(config.language).toBe('yaml')
    expect(config.headingLevel).toBe(3)
  })

  it('keeps the index page first, then the declared pages in order', () => {
    const config = readDocConfig({
      'x-doc': {
        pages: [
          { id: 'b', file: 'b.md' },
          { id: 'a', file: 'a.md' },
        ],
      },
    })
    expect(config.pages.map((page) => page.id)).toEqual([INDEX_PAGE_ID, 'b', 'a'])
  })

  // A schema may declare the index explicitly to give it examples of its own;
  // that should configure the index rather than add a second page.
  it('merges an explicitly declared index page', () => {
    const config = readDocConfig({
      title: 'Ignored',
      'x-doc': {
        pages: [{ id: 'index', file: 'configuration.md', title: 'Configuration', example: 'a = 1' }],
      },
    })
    expect(config.pages).toEqual([
      { id: INDEX_PAGE_ID, file: 'configuration.md', title: 'Configuration', examples: [{ code: 'a = 1' }] },
    ])
  })

  it('skips a page that cannot be written or referenced', () => {
    const config = readDocConfig({ 'x-doc': { pages: [{ id: 'a' }, { file: 'b.md' }, 'nope'] } })
    expect(config.pages).toHaveLength(1)
  })

  it('reads sections, defaulting them to the index page', () => {
    const config = readDocConfig({
      'x-doc': {
        sections: [
          { id: 'props', title: 'Properties', description: 'The options.' },
          { id: 'emitter', title: 'Emitter', page: 'ts', sort: 'alphabetical' },
        ],
      },
    })
    expect(config.sections).toEqual([
      { id: 'props', title: 'Properties', description: 'The options.', page: INDEX_PAGE_ID, examples: [] },
      { id: 'emitter', title: 'Emitter', page: 'ts', sort: 'alphabetical', examples: [] },
    ])
  })

  it('skips a section with no id to reference it by', () => {
    expect(readDocConfig({ 'x-doc': { sections: [{ title: 'Nameless' }] } }).sections).toEqual([])
  })

  // The schema is parsed JSON, not validated input.
  it('ignores malformed members and falls back to the defaults', () => {
    const config = readDocConfig({ 'x-doc': { language: 5, layout: 'grid', sort: 7, pages: 'nope', sections: 3 } })
    expect(config.language).toBe('json')
    expect(config.layout).toBe('headings')
    expect(config.pages).toHaveLength(1)
    expect(config.sections).toEqual([])
  })

  it('clamps a nonsensical heading level to a real one', () => {
    expect(readDocConfig({}, { headingLevel: 0 }).headingLevel).toBe(1)
    expect(readDocConfig({}, { headingLevel: Number.NaN }).headingLevel).toBe(1)
    expect(readDocConfig({}, { headingLevel: 2.7 }).headingLevel).toBe(2)
  })
})
