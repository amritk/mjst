import { describe, expect, it } from 'vitest'

import { parseYamlStrict } from './parse-yaml-strict'

const WHAT = 'a test document'

/** The message `parseYamlStrict` throws for `text`, or `''` when it does not throw. */
const messageFor = (text: string, options: { singleLine?: boolean } = {}): string => {
  try {
    parseYamlStrict(text, '/specs/doc.yaml', { what: WHAT, ...options })
  } catch (error) {
    return (error as Error).message
  }
  return ''
}

describe('parse-yaml-strict messages', () => {
  // `...` ends the first document; the next one starts on the line after it. The
  // message points at the marker without claiming the second document starts
  // there.
  it('points a `...`-separated stream at the marker the second document follows', () => {
    expect(messageFor('a: 1\n...\nb: 2\n')).toBe(
      '/specs/doc.yaml:2:1: this file contains multiple YAML documents (another one follows this marker); a test document must be a single-document file.',
    )
  })

  it('points a `---`-separated stream at the marker that opens the second document', () => {
    expect(messageFor('a: 1\n---\nb: 2\n')).toBe(
      '/specs/doc.yaml:2:1: this file contains multiple YAML documents (another one follows this marker); a test document must be a single-document file.',
    )
  })

  // Every listed problem already names `path:line:col`; the header naming the
  // path again only pushed the problems further right.
  it('names the file once per problem, not again in the header', () => {
    const message = messageFor('a: [1\n', { singleLine: true })
    expect(message).toBe('Failed to parse YAML: /specs/doc.yaml:1:4: Missing closing "]" for flow sequence')
    expect(message.split('/specs/doc.yaml')).toHaveLength(2)
  })
})
