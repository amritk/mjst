import { describe, expect, it } from 'vitest'
import { pageAnchors } from '#reference/page-anchors'
import { promoteBoldLabels } from '#reference/promote-bold-labels'
import type { RenderContext } from '#types/render'

const context = (promoteBold = true): RenderContext => ({
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
  steps: undefined,
  stepIds: pageAnchors(),
})

const WALKTHROUGH = [
  '**First release**',
  '',
  'Create a token.',
  '',
  '**Switch to trusted publishing**',
  '',
  'Register it.',
].join('\n')

describe('promote-bold-labels', () => {
  it('returns the prose untouched when the schema did not ask', () => {
    expect(promoteBoldLabels(WALKTHROUGH, 4, context(false))).toBe(WALKTHROUGH)
  })

  it('turns each label into a heading at the level it is given', () => {
    expect(promoteBoldLabels(WALKTHROUGH, 4, context())).toBe(
      ['#### First release', '', 'Create a token.', '', '#### Switch to trusted publishing', '', 'Register it.'].join(
        '\n',
      ),
    )
  })

  it('caps the level at six', () => {
    expect(promoteBoldLabels('**Deep**', 9, context())).toBe('###### Deep')
  })

  it('drops one trailing colon or period, inside the span or after it', () => {
    expect(promoteBoldLabels('**Setup:**', 3, context())).toBe('### Setup')
    expect(promoteBoldLabels('**Setup**:', 3, context())).toBe('### Setup')
    expect(promoteBoldLabels('**Setup.**', 3, context())).toBe('### Setup')
    expect(promoteBoldLabels('**Wait...**', 3, context())).toBe('### Wait..')
  })

  it('keeps inline markdown in the heading, and slugs the anchor from what a reader sees', () => {
    const ctx = context()
    expect(promoteBoldLabels('**Publish with `npm` _today_**', 3, ctx)).toBe('### Publish with `npm` _today_')
    expect(ctx.anchors.all()).toEqual(['publish-with-npm-today'])
  })

  it('collapses a label that wraps into one heading line', () => {
    expect(promoteBoldLabels('**Switch to trusted\npublishing**', 3, context())).toBe(
      '### Switch to trusted publishing',
    )
  })

  // A trailing `#` run is an ATX heading's closing sequence, and would vanish.
  it('keeps a trailing hash in the heading text', () => {
    expect(promoteBoldLabels('**Use C#**', 3, context())).toBe('### Use C\\#')
  })

  it('numbers a label that repeats, the way every heading on the page is', () => {
    const ctx = context()
    ctx.anchors.claim('Install')
    promoteBoldLabels('**Install**\n\nOne.\n\n**Install**\n\nTwo.', 3, ctx)
    expect(ctx.anchors.all()).toEqual(['install', 'install-1', 'install-2'])
  })

  it('leaves a label with no visible text bold', () => {
    expect(promoteBoldLabels('**.**', 3, context())).toBe('**.**')
  })

  it('leaves a lead-in, and a label inside a block, as written', () => {
    const prose = [
      '**Note.** The token expires.',
      '',
      '> **Quoted**',
      '',
      '- **Listed**',
      '',
      '```',
      '**Fenced**',
      '```',
    ].join('\n')
    expect(promoteBoldLabels(prose, 3, context())).toBe(prose)
  })
})
