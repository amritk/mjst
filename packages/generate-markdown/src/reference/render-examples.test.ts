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
})
