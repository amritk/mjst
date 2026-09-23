import { describe, expect, it } from 'vitest'
import { pageAnchors } from '#reference/page-anchors'
import { renderPropertyTable, tableOrder } from '#reference/render-property-table'
import type { DocSection, DocTable } from '#types/doc'
import type { DocEntry, RenderContext } from '#types/render'
import type { SchemaProperty } from '#types/schema'

const section = (id: string, overrides: Partial<DocSection> = {}): DocSection => ({
  id,
  page: 'typescript',
  examples: [],
  ...overrides,
})

/** The built-in table layout, which most of these tests render with. */
const DEFAULT_TABLE: DocTable = {
  type: 'auto',
  default: 'auto',
  required: 'marker',
  requiredMarker: ' _required_',
  requiredFirst: false,
}

const context = (overrides: Partial<RenderContext> = {}): RenderContext => ({
  language: 'json',
  layout: 'table',
  sort: 'schema',
  table: DEFAULT_TABLE,
  headings: { type: 'auto' },
  file: 'configuration.md',
  page: 'index',
  pageFiles: new Map([
    ['index', 'configuration.md'],
    ['typescript', 'configuration/typescript.md'],
  ]),
  sections: new Map([
    ['emitter', section('emitter')],
    ['advanced', section('advanced', { layout: 'table' })],
    ['prose', section('prose', { layout: 'none' })],
  ]),
  anchors: pageAnchors(),
  ...overrides,
})

/**
 * A page that has already rendered the property's own heading, which is what a
 * row on it links down to. The heading claims its anchor as it renders, so this
 * is the same thing the renderers do — one claim per heading, in page order.
 */
const headed = (...headings: readonly (readonly [string, DocEntry | undefined])[]): RenderContext => {
  const anchors = pageAnchors()
  for (const [text, target] of headings) anchors.claim(text, target)
  return context({ anchors })
}

/** A page whose root `x-doc.table` asks for something other than the default. */
const styled = (table: Partial<DocTable>): RenderContext => context({ table: { ...DEFAULT_TABLE, ...table } })

/** The marker the default style puts beside a required property's name. */
const REQUIRED_MARKER_TEXT = '_required_'

const entry = (name: string, prop: SchemaProperty, required = false): DocEntry => ({
  name,
  prop,
  path: [name],
  required,
})

describe('render-property-table', () => {
  it('renders a header, a divider and one row per property', () => {
    const table = renderPropertyTable(
      [entry('packageName', { type: 'string', description: 'Package name.' })],
      context(),
    )
    expect(table).toBe(
      ['| Property | Type | Description |', '| --- | --- | --- |', '| `packageName` | `string` | Package name. |'].join(
        '\n',
      ),
    )
  })

  // A column of blanks tells the reader nothing and costs them width.
  it('drops the default column when no row fills it', () => {
    expect(renderPropertyTable([entry('a', { type: 'string' })], context())).not.toContain('Default')
  })

  // One bit for a handful of rows is not worth a column of its own, and the
  // word needs no legend under the table to be understood.
  it('marks a required property in its own cell rather than in a column', () => {
    const table = renderPropertyTable([entry('a', { type: 'string' }, true), entry('b', { type: 'string' })], context())
    expect(table).toContain('| Property | Type | Description |')
    expect(table).not.toContain('Required')
    expect(table).toContain('| `a` _required_ | `string` |  |')
    expect(table).toContain('| `b` | `string` |  |')
  })

  // `object` is what every nested bag of options is: twenty rows of it spend a
  // column on one word twenty times.
  it('drops the type column when every row is an object', () => {
    const table = renderPropertyTable(
      [entry('typescript', { type: 'object', description: 'TS.' }), entry('python', { type: 'object' })],
      context(),
    )
    expect(table).toBe(
      ['| Property | Description |', '| --- | --- |', '| `typescript` | TS. |', '| `python` |  |'].join('\n'),
    )
  })

  it('drops the type column when no row states a type', () => {
    const table = renderPropertyTable([entry('a', { description: 'Anything.' })], context())
    expect(table).toBe(['| Property | Description |', '| --- | --- |', '| `a` | Anything. |'].join('\n'))
  })

  it('keeps the type column as soon as one row says something with it', () => {
    const table = renderPropertyTable(
      [entry('targets', { type: 'object' }), entry('environmentOrder', { type: 'array', items: { type: 'string' } })],
      context(),
    )
    expect(table).toContain('| Property | Type | Description |')
    expect(table).toContain('| `targets` | `object` |  |')
    expect(table).toContain('| `environmentOrder` | `string[]` |  |')
  })

  // "Every one of these is a string" is a fact about the options, unlike
  // "every one of these is an object", which is what a nested option bag is.
  it('keeps the type column when every row is the same useful type', () => {
    const table = renderPropertyTable(
      [entry('name', { type: 'string' }), entry('version', { type: 'string' })],
      context(),
    )
    expect(table).toContain('| Property | Type | Description |')
  })

  it('renders defaults in the page language', () => {
    const entries = [entry('branch', { type: 'string', default: 'main' })]
    expect(renderPropertyTable(entries, context())).toContain('| `"main"` |')
    expect(renderPropertyTable(entries, context({ language: 'javascript' }))).toContain("| `'main'` |")
  })

  // A `null` default is the absence of a value, not a value to copy.
  it('treats a null default as no default', () => {
    expect(renderPropertyTable([entry('a', { type: 'string', default: null })], context())).not.toContain('Default')
  })

  it('links a property documented on another page', () => {
    const table = renderPropertyTable(
      [entry('typescript', { type: 'object', 'x-doc': { page: 'typescript' } })],
      context(),
    )
    expect(table).toContain('| [`typescript`](configuration/typescript.md#typescript) |  |')
  })

  it('links relative to the page being rendered', () => {
    const table = renderPropertyTable(
      [entry('typescript', { type: 'object', 'x-doc': { page: 'index' } })],
      context({ file: 'guides/sdk.md', page: 'typescript' }),
    )
    expect(table).toContain('[`typescript`](../configuration.md#typescript)')
  })

  // A section carries its properties to its own page, so a row that ignored the
  // section's page led nowhere.
  it('links a property its section relocated to another page', () => {
    const table = renderPropertyTable(
      [entry('options', { type: 'object', 'x-doc': { section: 'emitter' } })],
      context(),
    )
    expect(table).toContain('[`options`](configuration/typescript.md#options)')
  })

  // A `table` section gives a heading to exactly the properties that have
  // something beyond their row, so the row only links when this one does.
  it('links into a table section on another page only when the property has a block there', () => {
    const entries = [entry('options', { type: 'object', 'x-doc': { section: 'advanced' } })]
    expect(renderPropertyTable(entries, context(), { summarised: () => true })).toContain(
      '[`options`](configuration/typescript.md#options)',
    )
    expect(renderPropertyTable(entries, context())).toContain('[`options`](configuration/typescript.md)')
  })

  // A `none` section renders its prose and examples alone, so there is no
  // heading on that page to aim at.
  it('does not anchor into a section that renders no properties', () => {
    const table = renderPropertyTable([entry('options', { type: 'object', 'x-doc': { section: 'prose' } })], context())
    expect(table).toContain('[`options`](configuration/typescript.md)')
  })

  // `heading: false` is the property that *is* the page: it has no heading of
  // its own there to land on.
  it('does not anchor a property rendered without a heading', () => {
    const table = renderPropertyTable(
      [entry('typescript', { type: 'object', 'x-doc': { page: 'typescript', heading: false } })],
      context(),
    )
    expect(table).toContain('| [`typescript`](configuration/typescript.md) |  |')
  })

  it('links a property to its own section on this page', () => {
    const organization = entry('organization', { type: 'object' })
    const table = renderPropertyTable([organization], headed(['organization', organization]))
    expect(table).toContain('| [`organization`](#organization) |  |')
  })

  // A page can easily carry two `name` headings — a top-level option and the
  // `name` of a pagination scheme four levels down — and a row that ignored
  // which one it meant sent every reader to the first.
  it('links to the numbered anchor a repeated heading gets', () => {
    const scheme = entry('name', { type: 'string' })
    const table = renderPropertyTable([scheme], headed(['name', undefined], ['name', scheme]))
    expect(table).toContain('[`name`](#name-1)')
  })

  // Most rows are a description and nothing else, so most properties get no
  // heading at all — and a link to one would take the reader nowhere.
  it('leaves a property with no section of its own unlinked', () => {
    const table = renderPropertyTable([entry('organization', { type: 'object' })], context())
    expect(table).toContain('| `organization` |  |')
    expect(table).not.toContain('](#')
  })

  it('does not link a property that lives on this page', () => {
    const table = renderPropertyTable([entry('a', { type: 'string', 'x-doc': { page: 'index' } })], context())
    expect(table).toContain('| `a` | `string` |  |')
  })

  // The anchor is slugged from the text the heading renders, not from the raw
  // name: the backticks a name needs are markup, and a reader never sees them.
  it('anchors a punctuated name the way its heading is slugged', () => {
    const property = entry('foo.bar $ref', { type: 'object' })
    const table = renderPropertyTable([property], headed(['foo.bar $ref', property]))
    expect(table).toContain('[`foo.bar $ref`](#foobar-ref)')
  })

  // `x-doc.title` replaces the heading text outright, so it replaces the anchor
  // the heading is slugged from too.
  it('anchors a titled property to its title', () => {
    const targets = entry('targets', { type: 'object', 'x-doc': { title: 'SDK targets' } })
    const table = renderPropertyTable([targets], headed(['SDK targets', targets]))
    expect(table).toContain('[`targets`](#sdk-targets)')
  })

  // A reference whose readers do not think in types, or whose types are in the
  // prose already, turns the column off everywhere at once.
  it('drops the type column entirely when the schema asks it to', () => {
    const table = renderPropertyTable(
      [entry('arrayFormat', { enum: ['comma', 'brackets'], description: 'How arrays are encoded.' })],
      styled({ type: 'never' }),
    )
    expect(table).toBe(
      ['| Property | Description |', '| --- | --- |', '| `arrayFormat` | How arrays are encoded. |'].join('\n'),
    )
  })

  // A docs site whose tables all have to line up keeps the column, blanks and
  // all.
  it('keeps the type column when the schema asks it to', () => {
    const table = renderPropertyTable([entry('targets', { type: 'object' })], styled({ type: 'always' }))
    expect(table).toContain('| Property | Type | Description |')
    expect(table).toContain('| `targets` | `object` |  |')
  })

  it('takes the same two answers for the default column', () => {
    const entries = [entry('branch', { type: 'string', default: 'main' })]
    expect(renderPropertyTable(entries, styled({ default: 'never' }))).not.toContain('Default')
    expect(renderPropertyTable([entry('a', { type: 'string' })], styled({ default: 'always' }))).toContain(
      '| Property | Type | Default | Description |',
    )
  })

  // The shape this package rendered before the marker, for a reference that
  // wants it back.
  it('renders a required column when the schema asks for one', () => {
    const table = renderPropertyTable(
      [entry('a', { type: 'string' }, true), entry('b', { type: 'string' })],
      styled({ required: 'column' }),
    )
    expect(table).toContain('| Property | Type | Required | Description |')
    expect(table).toContain('| `a` | `string` | ✅ |  |')
    expect(table).toContain('| `b` | `string` |  |  |')
    expect(table).not.toContain(REQUIRED_MARKER_TEXT)
  })

  // A reference with a legend of its own wants a symbol, and it hugs the name
  // because the author left the space out.
  it("puts the schema's own marker after a required name, exactly as written", () => {
    const table = renderPropertyTable(
      [entry('a', { type: 'string' }, true), entry('b', { type: 'string' })],
      styled({ requiredMarker: '*' }),
    )
    expect(table).toContain('| `a`* | `string` |  |')
    expect(table).toContain('| `b` | `string` |  |')
    expect(table).not.toContain(REQUIRED_MARKER_TEXT)
  })

  // Formatting is the point of changing it, so inline HTML is passed through.
  it('passes an HTML marker through untouched', () => {
    const table = renderPropertyTable(
      [entry('a', { type: 'string' }, true)],
      styled({ requiredMarker: '<br><sub><i>required</i></sub>' }),
    )
    expect(table).toContain('| `a`<br><sub><i>required</i></sub> | `string` |  |')
  })

  it('marks a linked name after its link', () => {
    const target = entry('a', { type: 'string' }, true)
    const table = renderPropertyTable([target], {
      ...headed(['a', target]),
      table: { ...DEFAULT_TABLE, requiredMarker: '*' },
    })
    expect(table).toContain('| [`a`](#a)* |')
  })

  // A marker is one fragment of one cell: a live pipe would add a column and a
  // line ending would end the row.
  it('keeps a marker from breaking the row it sits in', () => {
    const table = renderPropertyTable(
      [entry('a', { type: 'string' }, true)],
      styled({ requiredMarker: ' req | must\nset' }),
    )
    expect(table).toContain('| `a` req \\| must set | `string` |  |')
  })

  it('renders no marker at all when the schema asks for an empty one', () => {
    const table = renderPropertyTable([entry('a', { type: 'string' }, true)], styled({ requiredMarker: '' }))
    expect(table).toContain('| `a` | `string` |  |')
  })

  // The column says it instead, so a marker as well would say it twice.
  it('ignores the marker under the required column', () => {
    const table = renderPropertyTable(
      [entry('a', { type: 'string' }, true)],
      styled({ required: 'column', requiredMarker: '*' }),
    )
    expect(table).toContain('| `a` | `string` | ✅ |  |')
  })

  // A column of blanks is a column of blanks whichever style asked for it.
  it('drops the required column when no property is required', () => {
    expect(renderPropertyTable([entry('a', { type: 'string' })], styled({ required: 'column' }))).not.toContain(
      'Required',
    )
  })

  // One table, with the properties a reader has to fill in at the top of it.
  it('lists the required properties first when the schema asks it to', () => {
    const table = renderPropertyTable(
      [
        entry('slug', { type: 'string', description: 'Optional slug.' }),
        entry('name', { type: 'string', description: 'The name.' }, true),
        entry('url', { type: 'string', description: 'Where it lives.' }, true),
      ],
      styled({ requiredFirst: true }),
    )
    expect(table).toBe(
      [
        '| Property | Type | Description |',
        '| --- | --- | --- |',
        '| `name` _required_ | `string` | The name. |',
        '| `url` _required_ | `string` | Where it lives. |',
        '| `slug` | `string` | Optional slug. |',
      ].join('\n'),
    )
  })

  // The order groups them; the marker is still what says which group a row is
  // in, so a reader never has to find the boundary.
  it('keeps the marker on a required-first table', () => {
    const table = renderPropertyTable(
      [entry('name', { type: 'string' }, true), entry('slug', { type: 'string' })],
      styled({ requiredFirst: true }),
    )
    expect(table).toContain(`| \`name\` ${REQUIRED_MARKER_TEXT} |`)
  })

  // The two are separate choices: where requiredness is said, and what order
  // the rows are in.
  it('combines required-first with the required column', () => {
    const table = renderPropertyTable(
      [entry('slug', { type: 'string' }), entry('name', { type: 'string' }, true)],
      styled({ required: 'column', requiredFirst: true }),
    )
    expect(table).toBe(
      [
        '| Property | Type | Required | Description |',
        '| --- | --- | --- | --- |',
        '| `name` | `string` | ✅ |  |',
        '| `slug` | `string` |  |  |',
      ].join('\n'),
    )
  })

  it('leaves a table of entirely optional properties in its own order', () => {
    const entries = [entry('slug', { type: 'string' }), entry('title', { type: 'string' })]
    expect(renderPropertyTable(entries, styled({ requiredFirst: true }))).toBe(renderPropertyTable(entries, context()))
  })

  // The blocks a caller renders under the table follow their rows, so it needs
  // the same order the rows are in.
  it('orders entries required-first only when the schema asked for it', () => {
    const required = entry('name', { type: 'string' }, true)
    const optional = entry('slug', { type: 'string' })
    const entries = [optional, required]
    expect(tableOrder(entries, DEFAULT_TABLE)).toEqual(entries)
    expect(tableOrder(entries, { ...DEFAULT_TABLE, requiredFirst: true })).toEqual([required, optional])
  })

  // A row is one line and its columns are split on unescaped pipes.
  it('escapes a pipe in the schema text', () => {
    const table = renderPropertyTable(
      [entry('mode', { 'x-doc': { type: 'a | b' }, description: 'Either a | b.' })],
      context(),
    )
    expect(table).toContain('| `mode` | `a \\| b` | Either a \\| b. |')
  })

  it('keeps a multi-paragraph description to its first paragraph, on one line', () => {
    const table = renderPropertyTable(
      [entry('a', { type: 'string', description: 'First line.\nStill first.\n\nSecond paragraph.' })],
      context(),
    )
    expect(table).toContain('| `a` | `string` | First line. Still first. |')
    expect(table).not.toContain('Second paragraph')
  })
})
