import { describe, expect, it } from 'vitest'
import { renderConfigTable } from '#table/render-config-table'

/** The full-width row under a property's metadata. */
const detailRow = (html: string): string =>
  html.split('<tr>').find((row) => row.includes('colspan')) ?? '(no detail row)'

describe('render-config-table', () => {
  // The detail row spans the whole table, so every optional column has to be
  // counted. A short colspan silently narrows every description on the page.
  it('spans the detail row across the required column too', () => {
    const html = renderConfigTable({
      required: ['host'],
      properties: { host: { type: 'string', description: 'The host.' } },
    })
    expect(html).toContain('<th align="center">Required</th>')
    // Property, Type, Required.
    expect(detailRow(html)).toContain('colspan="3"')
  })

  it('counts every optional column in the detail row span', () => {
    const html = renderConfigTable({
      required: ['host'],
      properties: {
        host: { type: 'string', description: 'The host.', default: 'localhost', 'x-cli-flag': '--host' },
      },
    })
    // Property, CLI Flag, Type, Required, Default.
    expect(detailRow(html)).toContain('colspan="5"')
  })

  // A column of blanks tells the reader nothing and costs them width.
  it('drops the default column when every default is null', () => {
    const html = renderConfigTable({ properties: { host: { type: 'string', default: null } } })
    expect(html).not.toContain('Default</th>')
  })

  it('leaves a null default cell empty when another property has a real one', () => {
    const html = renderConfigTable({
      properties: { host: { type: 'string', default: 'localhost' }, port: { type: 'number', default: null } },
    })
    expect(html).toContain('<th align="center">Default</th>')
    // The cell is empty, not a rendered `null` — that is the whole point of
    // treating a null default as no default. (`formatValue(null)` is `''`
    // whichever guard reaches it, so only the empty cell is worth asserting.)
    expect(html).toContain('<td align="center"></td>')
  })

  // The constraints read in the order the reader meets them: what is allowed,
  // then what it looks like.
  it('puts the allowed values before the examples', () => {
    const html = renderConfigTable({
      properties: { mode: { type: 'string', description: 'Mode.', enum: ['a'], examples: ['a'] } },
    })
    const cell = detailRow(html)
    // Both named first: an absent Allowed line is `indexOf` -1, which is less
    // than anything the assertion could compare it to.
    expect(cell).toContain('<strong>Allowed:</strong>')
    expect(cell).toContain('<strong>Examples:</strong>')
    expect(cell.indexOf('<strong>Allowed:</strong>')).toBeLessThan(cell.indexOf('<strong>Examples:</strong>'))
  })

  // With no description the cell leads with the allowed list, not a stray
  // separator before it.
  it('does not open the detail cell with an empty line', () => {
    const html = renderConfigTable({ properties: { mode: { type: 'string', enum: ['a', 'b'] } } })
    expect(detailRow(html)).toContain('<td colspan="2"><strong>Allowed:</strong>')
  })

  // An underscore is a legal HTML id character, and collapsing it made two
  // properties that differ only there collide.
  it('keeps an underscore in an anchor id', () => {
    const html = renderConfigTable({
      properties: { api_key: { type: 'object', properties: { value: { type: 'string' } } } },
    })
    expect(html).toContain('id="config-api_key"')
  })

  // Every offending character collapses, not just the first: a single
  // replacement left the rest of them in the attribute.
  it('collapses every character an anchor id cannot hold', () => {
    const html = renderConfigTable({
      properties: { 'a"b"c': { type: 'object', properties: { value: { type: 'string' } } } },
    })
    expect(html).toContain('id="config-a-b-c"')
  })

  // A blank line between tables, or a docs site runs the second table's header
  // into the first table's last row.
  it('separates a nested table from the one above it with a blank line', () => {
    const html = renderConfigTable({
      properties: { server: { type: 'object', properties: { host: { type: 'string' } } } },
    })
    expect(html).toContain('</table>\n\n<a id="config-server">')
  })

  // A column of blanks tells the reader nothing and costs them width — and a
  // column that is rendered but not counted leaves every colspan short.
  it('drops the type column when nothing has a type to show', () => {
    const html = renderConfigTable({ properties: { a: { description: 'A.' } } })
    expect(html).not.toContain('<th>Type</th>')
    expect(detailRow(html)).toContain('colspan="1"')
  })

  // The columns read left to right in the order the header names them.
  it('puts the CLI flag column before the type column', () => {
    const html = renderConfigTable({ properties: { a: { type: 'string', 'x-cli-flag': '--a' } } })
    expect(html.indexOf('<th>CLI Flag</th>')).toBeGreaterThan(0)
    expect(html.indexOf('<th>CLI Flag</th>')).toBeLessThan(html.indexOf('<th>Type</th>'))
  })

  // A type label is schema text like any other — `type` is parsed JSON, not a
  // validated keyword — and a raw `<` in a cell is live markup.
  it('escapes a type label before putting it in a cell', () => {
    const html = renderConfigTable({ properties: { a: { type: 'a<b&c' } } })
    expect(html).toContain('<code>a&lt;b&amp;c</code>')
  })

  // A raw newline ends the `<table>`'s HTML block mid-row, and every tag after
  // it renders as literal text.
  it('joins the detail cell lines without a line ending', () => {
    const html = renderConfigTable({ properties: { a: { type: 'string', description: 'A.', enum: ['x'] } } })
    expect(detailRow(html)).toContain('A.<br><strong>Allowed:</strong>')
  })

  // An array is not an object, and reading one as a property map gave the
  // table a row named `0`.
  it('ignores a properties keyword that is not a map', () => {
    expect(renderConfigTable({ properties: [{ type: 'string' }] as never })).not.toContain('<code>0</code>')
  })

  // An empty `properties: {}` has nothing to link to, and the link led to an
  // empty detail table.
  it('does not link a property whose object has no fields', () => {
    const html = renderConfigTable({ properties: { a: { type: 'object', properties: {} } } })
    expect(html).not.toContain('href="#config-a"')
  })

  // The whole point of `x-extra-columns`: a schema carries its own vendor data
  // into the table without this package having to know the keyword.
  it('renders a column declared in x-extra-columns', () => {
    const html = renderConfigTable({
      'x-extra-columns': { 'x-scalar-stability': 'Stability' },
      properties: { host: { type: 'string', 'x-scalar-stability': 'experimental' } },
    })
    expect(html).toContain('<th>Stability</th>')
    expect(html).toContain('<td>experimental</td>')
    // Property, Type, Stability.
    expect(detailRow(html)).toContain('colspan="3"')
  })

  // The extras come last, so adding one never moves the columns a reader
  // already knows.
  it('puts the extra columns after the built-in ones', () => {
    const html = renderConfigTable({
      'x-extra-columns': { 'x-scalar-stability': 'Stability' },
      properties: { host: { type: 'string', default: 'localhost', 'x-scalar-stability': 'stable' } },
    })
    expect(html.indexOf('<th align="center">Default</th>')).toBeLessThan(html.indexOf('<th>Stability</th>'))
  })

  it('renders the extra columns in declaration order', () => {
    const html = renderConfigTable({
      'x-extra-columns': { 'x-since': 'Since', 'x-scalar-stability': 'Stability' },
      properties: { host: { type: 'string', 'x-since': '1.2.0', 'x-scalar-stability': 'stable' } },
    })
    expect(html.indexOf('<th>Since</th>')).toBeLessThan(html.indexOf('<th>Stability</th>'))
    expect(html).toContain('<td>1.2.0</td>\n<td>stable</td>')
  })

  // Same rule as the built-in columns: a column of blanks tells the reader
  // nothing and costs them width.
  it('drops a declared column no property fills', () => {
    const html = renderConfigTable({
      'x-extra-columns': { 'x-scalar-stability': 'Stability' },
      properties: { host: { type: 'string' } },
    })
    expect(html).not.toContain('Stability')
    expect(detailRow(html)).toContain('colspan="2"')
  })

  // The scan spans the whole schema, so every table keeps the same set of
  // columns — a nested-only value has to keep the column on the main table too,
  // or the two tables disagree and the detail row's colspan goes with them.
  it('keeps a column a nested property alone fills', () => {
    const html = renderConfigTable({
      'x-extra-columns': { 'x-scalar-stability': 'Stability' },
      properties: {
        server: { type: 'object', properties: { host: { type: 'string', 'x-scalar-stability': 'beta' } } },
      },
    })
    // Once for the main table, once for the nested detail table.
    expect(html.split('<th>Stability</th>')).toHaveLength(3)
    expect(html).toContain('<td>beta</td>')
    // The row for `server` itself has nothing to say in the column.
    expect(html).toContain('<td></td>')
  })

  // The header is author text like any other, and a raw `<` in it is live
  // markup.
  it('escapes an extra column header', () => {
    const html = renderConfigTable({
      'x-extra-columns': { 'x-note': '<b>Note</b>' },
      properties: { host: { type: 'string', 'x-note': 'hi' } },
    })
    expect(html).toContain('<th>&lt;b&gt;Note&lt;/b&gt;</th>')
  })

  // A declaration that is not a keyword to header map is parsed JSON gone
  // wrong, not a table to render.
  it('ignores a malformed x-extra-columns declaration', () => {
    const html = renderConfigTable({
      'x-extra-columns': 'x-scalar-stability' as never,
      properties: { host: { type: 'string', 'x-scalar-stability': 'experimental' } },
    })
    expect(html).not.toContain('experimental')
    expect(detailRow(html)).toContain('colspan="2"')
  })
})
