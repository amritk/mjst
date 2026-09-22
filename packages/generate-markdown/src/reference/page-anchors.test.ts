import { describe, expect, it } from 'vitest'
import { pageAnchors, renderHeading } from '#reference/page-anchors'
import type { DocEntry, PageAnchors, RenderContext } from '#types/render'

const entry = (name: string): DocEntry => ({ name, prop: { type: 'string' }, path: [name], required: false })

const context = (anchors: PageAnchors): RenderContext => ({
  language: 'json',
  layout: 'table',
  sort: 'schema',
  table: { type: 'auto', default: 'auto', required: 'marker', requiredFirst: false },
  headings: { type: 'auto' },
  file: 'configuration.md',
  page: 'index',
  pageFiles: new Map([['index', 'configuration.md']]),
  sections: new Map(),
  anchors,
})

describe('page-anchors', () => {
  it('gives a heading the anchor a docs site would', () => {
    expect(pageAnchors().claim('SDK targets')).toBe('sdk-targets')
  })

  // A page can carry a top-level `name` option and the `name` of a scheme
  // nested four levels under it, and a docs site tells them apart.
  it('numbers each repeat of an anchor', () => {
    const anchors = pageAnchors()
    expect([anchors.claim('name'), anchors.claim('name'), anchors.claim('name')]).toEqual(['name', 'name-1', 'name-2'])
  })

  it('remembers the anchor a property heading claimed', () => {
    const anchors = pageAnchors()
    const scheme = entry('name')
    anchors.claim('name')
    anchors.claim('name', scheme)
    expect(anchors.anchorOf(scheme)).toBe('name-1')
  })

  it('has no anchor for a property whose heading never rendered', () => {
    expect(pageAnchors().anchorOf(entry('name'))).toBeUndefined()
  })

  // A summarised block that holds nothing but its heading is never printed, and
  // a claim left behind for it would number the next `name` one too high and
  // leave a row pointing at an anchor the page does not carry.
  it('gives back the claim a heading that was not printed made', () => {
    const anchors = pageAnchors()
    const dropped = entry('name')
    anchors.claim('name')
    anchors.claim('name', dropped)
    anchors.undoClaim()
    expect(anchors.anchorOf(dropped)).toBeUndefined()
    expect(anchors.claim('name')).toBe('name-1')
  })

  // A heading of pure punctuation has no anchor to count, here or on a docs
  // site.
  it('counts nothing for a heading that slugs to nothing', () => {
    const anchors = pageAnchors()
    expect(anchors.claim('***')).toBe('')
    expect(anchors.claim('***')).toBe('')
  })

  it('renders the markdown of a heading while claiming the text it renders as', () => {
    const anchors = pageAnchors()
    const property = entry('foo.bar')
    const line = renderHeading(3, { markdown: '`foo.bar`', text: 'foo.bar' }, context(anchors), property)
    expect(line).toBe('### `foo.bar`')
    expect(anchors.anchorOf(property)).toBe('foobar')
  })
})
