import { describe, expect, it } from 'vitest'
import { renderExamples } from '#reference/render-examples'

describe('render-examples', () => {
  it('renders nothing for no examples', () => {
    expect(renderExamples([], 'json')).toEqual([])
  })

  it('fences code in the page language', () => {
    expect(renderExamples([{ code: 'const a = 1' }], 'javascript')).toEqual(['```javascript\nconst a = 1\n```'])
  })

  it('lets an example choose its own language', () => {
    expect(renderExamples([{ code: 'acme --help', language: 'bash' }], 'json')).toEqual(['```bash\nacme --help\n```'])
  })

  it('renders a caption as its own block above the fence', () => {
    expect(renderExamples([{ code: 'a', caption: 'Like so:' }], 'json')).toEqual(['Like so:', '```json\na\n```'])
  })

  it('serializes a value example in the fence language', () => {
    expect(renderExamples([{ value: { a: 1 } }], 'javascript')).toEqual(['```javascript\n{\n  a: 1\n}\n```'])
  })

  it('prefers literal code over a value when an example carries both', () => {
    expect(renderExamples([{ code: 'written', value: { a: 1 } }], 'json')).toEqual(['```json\nwritten\n```'])
  })

  it('drops an example with neither code nor value', () => {
    expect(renderExamples([{ caption: 'Nothing' }], 'json')).toEqual([])
  })

  // The fence has to be longer than any run inside, or the block ends early and
  // the rest of the sample spills onto the page.
  it('widens the fence past one inside the example', () => {
    expect(renderExamples([{ code: '```js\nx\n```' }], 'json')).toEqual(['````json\n```js\nx\n```\n````'])
  })

  it('trims the trailing blank lines a schema string often carries', () => {
    expect(renderExamples([{ code: 'a\n\n' }], 'json')).toEqual(['```json\na\n```'])
  })

  it('renders each example in order', () => {
    expect(renderExamples([{ code: 'a' }, { code: 'b' }], 'json')).toEqual(['```json\na\n```', '```json\nb\n```'])
  })

  // A fence anywhere in the sample closes the block, not only one on its first
  // line — the rest of the page then renders inside the fence that got away.
  it('outruns a fence that starts partway down the sample', () => {
    const blocks = renderExamples([{ code: 'const a = 1\n```\nstill code\n```' }], 'javascript')
    expect(blocks[0]?.startsWith('````javascript\n')).toBe(true)
    expect(blocks[0]?.endsWith('\n````')).toBe(true)
  })

  // `c++` and `c#` are language names, and dropping their punctuation labelled
  // the block as a different language.
  it('keeps the punctuation a language name uses', () => {
    expect(renderExamples([{ code: 'int a;', language: 'c++' }], 'json')[0]).toContain('```c++')
    expect(renderExamples([{ code: 'int a;', language: 'c#' }], 'json')[0]).toContain('```c#')
  })

  // `null` is a legitimate default to show, so presence of the key is what
  // counts — an example with neither `code` nor `value` renders nothing.
  it('prints a null value and skips an example with no value at all', () => {
    expect(renderExamples([{ value: null }], 'json')[0]).toBe('```json\nnull\n```')
    expect(renderExamples([{ caption: 'Nothing to show.' }], 'json')).toEqual([])
  })

  // CommonMark lets a fence be indented up to three spaces, so an indented one
  // inside a sample closes the block just as surely as a flush one.
  it('outruns a fence the sample indents', () => {
    const blocks = renderExamples([{ code: 'a\n   ```\nb' }], 'json')
    expect(blocks[0]?.startsWith('````json\n')).toBe(true)
  })

  // A language name can hold a dot or an underscore — `objective-c`, `f#`,
  // `foo.bar` — and dropping one labelled the block as a different language.
  it('keeps a dot or an underscore in a language name', () => {
    expect(renderExamples([{ code: 'x', language: 'foo.bar' }], 'json')[0]).toContain('```foo.bar')
    expect(renderExamples([{ code: 'x', language: 'foo_bar' }], 'json')[0]).toContain('```foo_bar')
  })
})
