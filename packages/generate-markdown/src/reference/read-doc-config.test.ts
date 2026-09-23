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

  // A schema may declare the index explicitly to give it a file or a title;
  // that configures the index rather than adding a second page.
  it('configures the index page rather than adding one', () => {
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

  // Both sides carry examples here, which is what makes this a merge: taking
  // either side alone would silently discard the other's.
  it('merges the examples of a declared index page with the root ones', () => {
    const config = readDocConfig({
      'x-doc': {
        example: 'from the root',
        pages: [{ id: 'index', file: 'configuration.md', example: 'from the page' }],
      },
    })
    expect(config.pages[0]?.examples).toEqual([{ code: 'from the root' }, { code: 'from the page' }])
  })

  // The page declaration is the more specific statement, so it wins.
  it('prefers a declared index title over the x-doc title', () => {
    const config = readDocConfig({
      'x-doc': { title: 'From x-doc', pages: [{ id: 'index', file: 'a.md', title: 'From the page' }] },
    })
    expect(config.pages[0]?.title).toBe('From the page')
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

  it('reads a section layout, ignoring one outside the vocabulary', () => {
    const config = readDocConfig({
      'x-doc': {
        sections: [
          { id: 'req', title: 'Required', layout: 'table' },
          { id: 'rest', title: 'Rest', layout: 'grid' },
        ],
      },
    })
    expect(config.sections).toEqual([
      { id: 'req', title: 'Required', page: INDEX_PAGE_ID, layout: 'table', examples: [] },
      { id: 'rest', title: 'Rest', page: INDEX_PAGE_ID, examples: [] },
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

  // "The schema wins on content and the caller wins on placement": a build that
  // writes the same schema somewhere else should not have to edit the schema.
  it('lets the caller beat a declared index page on title and file', () => {
    const config = readDocConfig(
      { 'x-doc': { pages: [{ id: 'index', file: 'from-schema.md', title: 'From schema' }] } },
      { title: 'From caller', file: 'from-caller.md' },
    )
    expect(config.pages[0]?.title).toBe('From caller')
    expect(config.pages[0]?.file).toBe('from-caller.md')
  })

  // Nobody has to think about the table shape for it to be a sensible one.
  it('defaults the table to columns that earn their width', () => {
    expect(readDocConfig({}).table).toEqual({
      type: 'auto',
      default: 'auto',
      required: 'column',
      requiredFirst: false,
    })
  })

  it('reads the table layout the schema declares', () => {
    const config = readDocConfig({
      'x-doc': {
        table: { type: 'never', default: 'always', required: '*', requiredFirst: true },
      },
    })
    expect(config.table).toEqual({
      type: 'never',
      default: 'always',
      required: '*',
      requiredFirst: true,
    })
  })

  // Per member, so turning the type column off does not silently restate the
  // rest of a schema's choices as the defaults.
  it('lets the caller override one member of the table layout', () => {
    const config = readDocConfig({ 'x-doc': { table: { requiredFirst: true } } }, { table: { type: 'never' } })
    expect(config.table).toEqual({
      type: 'never',
      default: 'auto',
      required: 'column',
      requiredFirst: true,
    })
  })

  it('lets the caller override the required suffix', () => {
    const config = readDocConfig({ 'x-doc': { table: { required: '*' } } }, { table: { required: 'column' } })
    expect(config.table.required).toBe('column')
  })

  // The empty string is a choice — no marker at all — not a missing value.
  it('keeps an empty required suffix', () => {
    expect(readDocConfig({ 'x-doc': { table: { required: '' } } }).table.required).toBe('')
  })

  // The schema is parsed JSON, so a typo should leave the built-in shape rather
  // than throw halfway through a docs build.
  it('ignores a table member it does not understand', () => {
    const config = readDocConfig({
      'x-doc': { table: { type: 'sometimes', required: 7, requiredFirst: 'yes' } },
    })
    expect(config.table).toEqual({
      type: 'auto',
      default: 'auto',
      required: 'column',
      requiredFirst: false,
    })
  })

  it('labels every heading with its type unless told otherwise', () => {
    expect(readDocConfig({}).headings).toEqual({ type: 'auto' })
  })

  it('reads the heading layout the schema declares, and lets the caller override it', () => {
    expect(readDocConfig({ 'x-doc': { headings: { type: 'never' } } }).headings).toEqual({ type: 'never' })
    expect(
      readDocConfig({ 'x-doc': { headings: { type: 'never' } } }, { headings: { type: 'auto' } }).headings,
    ).toEqual({ type: 'auto' })
  })

  // `always` is a table-column word: a heading with no type to state has
  // nothing to print, so it is not a value this member takes.
  it('ignores a heading member it does not understand', () => {
    expect(readDocConfig({ 'x-doc': { headings: { type: 'always' } } }).headings).toEqual({ type: 'auto' })
    expect(readDocConfig({ 'x-doc': { headings: { type: false } } }).headings).toEqual({ type: 'auto' })
  })
})
