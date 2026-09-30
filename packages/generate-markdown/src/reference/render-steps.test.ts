import { describe, expect, it } from 'vitest'
import { pageAnchors } from '#reference/page-anchors'
import { renderSteps } from '#reference/render-steps'
import type { DocSteps } from '#types/doc'
import type { RenderContext } from '#types/render'

const SCALAR: DocSteps = {
  open: '<scalar-steps>',
  close: '</scalar-steps>',
  stepOpen: '<scalar-step id="{id}" title="{title}">',
  stepClose: '</scalar-step>',
}

const context = (steps: DocSteps | undefined = SCALAR): RenderContext => ({
  language: 'json',
  layout: 'headings',
  sort: 'schema',
  table: { type: 'auto', default: 'auto', required: 'column', requiredFirst: false },
  headings: { type: 'auto' },
  file: 'index.md',
  page: 'index',
  pageFiles: new Map([['index', 'index.md']]),
  sections: new Map(),
  anchors: pageAnchors(),
  steps,
  stepIds: pageAnchors(),
})

const RELEASE = [
  '**First release**',
  '',
  '1. **Create an access token.** Give it publish permission and turn 2FA bypass on.',
  '2. **Add it as a repository secret.** Name it `NPM_TOKEN`.',
  '3. **Merge the release pull request.**',
].join('\n')

describe('render-steps', () => {
  it('returns the prose untouched when steps are off', () => {
    expect(renderSteps(RELEASE, { ...context(), steps: undefined })).toBe(RELEASE)
  })

  it('renders a lead-in list as steps', () => {
    expect(renderSteps(RELEASE, context())).toBe(
      [
        '**First release**',
        '',
        '<scalar-steps>',
        '  <scalar-step id="create-an-access-token" title="Create an access token">',
        '',
        'Give it publish permission and turn 2FA bypass on.',
        '',
        '  </scalar-step>',
        '  <scalar-step id="add-it-as-a-repository-secret" title="Add it as a repository secret">',
        '',
        'Name it `NPM_TOKEN`.',
        '',
        '  </scalar-step>',
        '  <scalar-step id="merge-the-release-pull-request" title="Merge the release pull request">',
        '  </scalar-step>',
        '</scalar-steps>',
      ].join('\n'),
    )
  })

  it('leaves a list with any item missing its lead-in as a list', () => {
    const mixed = '1. **Create a token.** Give it rights.\n2. Add it as a secret.'
    expect(renderSteps(mixed, context())).toBe(mixed)
  })

  it('leaves a list inside a fence as it is', () => {
    const fenced = '```md\n1. **Create a token.** Give it rights.\n```'
    expect(renderSteps(fenced, context())).toBe(fenced)
  })

  it('carries nested bullets and a fence into the step body at column 0', () => {
    const prose = ['1. **Install.** Pick one:', '   - npm', '   - bun', '', '   ```sh', '   npm i', '   ```'].join('\n')
    expect(renderSteps(prose, context())).toBe(
      [
        '<scalar-steps>',
        '  <scalar-step id="install" title="Install">',
        '',
        'Pick one:',
        '- npm',
        '- bun',
        '',
        '```sh',
        'npm i',
        '```',
        '',
        '  </scalar-step>',
        '</scalar-steps>',
      ].join('\n'),
    )
  })

  // Descriptions are untrusted: a quote in a title must not close the attribute.
  it('escapes the title for its attribute and strips its markdown', () => {
    const out = renderSteps('1. **Say `"hi"` & <b>wave</b>.** Then go.', context())
    expect(out).toContain('<scalar-step id="say-hi--wave" title="Say &quot;hi&quot; &amp; wave">')
  })

  it('does not fill a placeholder that the title itself contains', () => {
    const out = renderSteps('1. **Use {id} here.** x', context())
    expect(out).toContain('<scalar-step id="use-id-here" title="Use {id} here">')
  })

  it('numbers repeated titles so every id on the page is unique', () => {
    const ctx = context()
    const first = renderSteps('1. **Deploy.** a\n2. **Deploy.** b', ctx)
    // A later description on the same page keeps counting.
    const second = renderSteps('1. **Deploy.** c\n2. **Deploy 1.** d', ctx)
    expect(first).toContain('id="deploy"')
    expect(first).toContain('id="deploy-1"')
    expect(second).toContain('id="deploy-2"')
    expect(second).toContain('id="deploy-1-1"')
  })

  it('falls back to a generic id for a title that slugs to nothing', () => {
    expect(renderSteps('1. **….** a\n2. **!!!** b', context())).toContain('id="step-1"')
  })

  // An HTML block cannot interrupt a paragraph, so the tags need a blank line
  // above them — and one below, or the prose after them joins the block.
  it('sets the markup off from the prose around it', () => {
    expect(renderSteps('Do this:\n1. **Go.** Now.\n\nThen rest.', context())).toBe(
      [
        'Do this:',
        '',
        '<scalar-steps>',
        '  <scalar-step id="go" title="Go">',
        '',
        'Now.',
        '',
        '  </scalar-step>',
        '</scalar-steps>',
        '',
        'Then rest.',
      ].join('\n'),
    )
  })

  it('omits an empty wrapper and fills placeholders in the closing tag too', () => {
    const steps: DocSteps = {
      open: '',
      close: '',
      stepOpen: '<Step title="{title}">',
      stepClose: '</Step><!-- {id} -->',
    }
    expect(renderSteps('1. **Go.** Now.', context(steps))).toBe('  <Step title="Go">\n\nNow.\n\n  </Step><!-- go -->')
  })
})
