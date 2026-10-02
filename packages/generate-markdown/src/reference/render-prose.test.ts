import { describe, expect, it } from 'vitest'
import { pageAnchors } from '#reference/page-anchors'
import { renderProse } from '#reference/render-prose'
import type { DocSteps } from '#types/doc'
import type { RenderContext } from '#types/render'

const SCALAR: DocSteps = {
  open: '<scalar-steps>',
  close: '</scalar-steps>',
  stepOpen: '<scalar-step id="{id}" title="{title}">',
  stepClose: '</scalar-step>',
}

const context = (promoteBold: boolean, steps: DocSteps | undefined): RenderContext => ({
  language: 'json',
  layout: 'headings',
  sort: 'schema',
  table: { type: 'auto', default: 'auto', required: 'column', requiredFirst: false },
  headings: { type: 'auto', promoteBold },
  file: 'index.md',
  page: 'index',
  pageFiles: new Map([['index', 'index.md']]),
  sections: new Map(),
  anchors: pageAnchors(),
  steps,
  stepIds: pageAnchors(),
})

const RELEASE = ['**First release**', '', '1. **Create a token.** Give it rights.', '', '   **Not a label**'].join('\n')

describe('render-prose', () => {
  it('returns the prose untouched when nothing is opted into', () => {
    expect(renderProse(RELEASE, 4, context(false, undefined))).toBe(RELEASE)
  })

  // The label is promoted before the steps render, while the step body is
  // still inside its list item — so the bold line in the body stays bold.
  it('promotes the label above a step list, converts the list, and leaves the step body alone', () => {
    expect(renderProse(RELEASE, 4, context(true, SCALAR))).toBe(
      [
        '#### First release',
        '',
        '<scalar-steps>',
        '<scalar-step id="create-a-token" title="Create a token">',
        '',
        'Give it rights.',
        '',
        '**Not a label**',
        '',
        '</scalar-step>',
        '</scalar-steps>',
      ].join('\n'),
    )
  })

  it('converts a list written straight under its label, with no blank line between', () => {
    const tight = '**First release**\n1. **Create a token.** Give it rights.'
    expect(renderProse(tight, 2, context(true, SCALAR))).toBe(
      [
        '## First release',
        '',
        '<scalar-steps>',
        '<scalar-step id="create-a-token" title="Create a token">',
        '',
        'Give it rights.',
        '',
        '</scalar-step>',
        '</scalar-steps>',
      ].join('\n'),
    )
  })
})
