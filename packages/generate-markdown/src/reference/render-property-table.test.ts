import { describe, expect, it } from 'vitest'
import { renderPropertyTable } from '#reference/render-property-table'
import type { DocEntry, RenderContext } from '#types/render'
import type { SchemaProperty } from '#types/schema'

const context = (overrides: Partial<RenderContext> = {}): RenderContext => ({
  language: 'json',
  layout: 'table',
  sort: 'schema',
  file: 'configuration.md',
  page: 'index',
  pageFiles: new Map([
    ['index', 'configuration.md'],
    ['typescript', 'configuration/typescript.md'],
  ]),
  sectionPages: new Map([['emitter', 'typescript']]),
  ...overrides,
})

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
  it('drops the required and default columns when no row fills them', () => {
    const table = renderPropertyTable([entry('a', { type: 'string' })], context())
    expect(table).not.toContain('Required')
    expect(table).not.toContain('Default')
  })

  it('adds the required column as soon as one property needs it', () => {
    const table = renderPropertyTable([entry('a', { type: 'string' }, true), entry('b', { type: 'string' })], context())
    expect(table).toContain('| Property | Type | Required | Description |')
    expect(table).toContain('| `a` | `string` | ✅ |  |')
    expect(table).toContain('| `b` | `string` |  |  |')
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
    expect(table).toContain('| [`typescript`](configuration/typescript.md) | `object` |  |')
  })

  it('links relative to the page being rendered', () => {
    const table = renderPropertyTable(
      [entry('typescript', { type: 'object', 'x-doc': { page: 'index' } })],
      context({ file: 'guides/sdk.md', page: 'typescript' }),
    )
    expect(table).toContain('[`typescript`](../configuration.md)')
  })

  // A section carries its properties to its own page, so a row that ignored the
  // section's page led nowhere.
  it('links a property its section relocated to another page', () => {
    const table = renderPropertyTable(
      [entry('options', { type: 'object', 'x-doc': { section: 'emitter' } })],
      context(),
    )
    expect(table).toContain('[`options`](configuration/typescript.md)')
  })

  it('does not link a property that lives on this page', () => {
    const table = renderPropertyTable([entry('a', { type: 'string', 'x-doc': { page: 'index' } })], context())
    expect(table).toContain('| `a` | `string` |  |')
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
