import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadAsyncApiDocument } from './load-asyncapi-document'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'load-aas-yaml-'))

/** An AsyncAPI document whose one payload is a cross-file `$ref` to `target`. */
const withPayloadRef = (target: string): string =>
  [
    'asyncapi: 2.6.0',
    'info: { title: T, version: 1.0.0 }',
    'channels:',
    '  events:',
    '    publish:',
    '      message:',
    '        name: evt',
    '        payload:',
    `          $ref: '${target}'`,
    '',
  ].join('\n')

describe('load-asyncapi-document', () => {
  it('names the line:col of each YAML problem in the document', async () => {
    const file = join(tmp(), 'broken.yaml')
    writeFileSync(file, 'asyncapi: 2.6.0\nchannels:\n  bad: [unclosed\n')

    await expect(loadAsyncApiDocument({}, file)).rejects.toThrow(
      `Failed to parse YAML:\n  - ${file}:3:8: Missing closing "]" for flow sequence`,
    )
  })

  it('points a multi-document refusal at the second document', async () => {
    const file = join(tmp(), 'multi.yaml')
    writeFileSync(file, 'asyncapi: 2.6.0\n---\nasyncapi: 2.6.0\n')

    await expect(loadAsyncApiDocument({}, file)).rejects.toThrow(
      `${file}:2:1: this file contains multiple YAML documents (another one follows this marker); an AsyncAPI document must be a single-document file.`,
    )
  })

  // A malformed referenced file fails the resolve like a missing one does,
  // located inside that file, on one line of the resolve-error list.
  it('reports a malformed referenced YAML file with its own line:col', async () => {
    const dir = tmp()
    const payload = join(dir, 'payload.yaml')
    writeFileSync(payload, 'type: object\nrequired: [id\n')
    const file = join(dir, 'api.yaml')
    writeFileSync(file, withPayloadRef('./payload.yaml'))

    await expect(loadAsyncApiDocument({}, file)).rejects.toThrow(
      `Failed to resolve $refs in ${file}:\n  - Failed to parse YAML: ${payload}:2:11: Missing closing "]" for flow sequence`,
    )
  })

  it('refuses a multi-document referenced YAML file', async () => {
    const dir = tmp()
    const payload = join(dir, 'payload.yaml')
    writeFileSync(payload, 'type: object\n---\ntype: string\n')
    const file = join(dir, 'api.yaml')
    writeFileSync(file, withPayloadRef('./payload.yaml'))

    await expect(loadAsyncApiDocument({}, file)).rejects.toThrow(
      `${payload}:2:1: this file contains multiple YAML documents (another one follows this marker); a $ref target must be a single-document file.`,
    )
  })

  it('inlines a well-formed referenced YAML file', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'payload.yaml'), 'type: object\nproperties:\n  id: { type: string }\n')
    const file = join(dir, 'api.yaml')
    writeFileSync(file, withPayloadRef('./payload.yaml'))

    const document = await loadAsyncApiDocument({}, file)

    expect(document).toMatchObject({
      channels: {
        events: { publish: { message: { payload: { type: 'object', properties: { id: { type: 'string' } } } } } },
      },
    })
  })
})
