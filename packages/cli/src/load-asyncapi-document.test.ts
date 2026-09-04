import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractAsyncApi } from '@amritk/asyncapi'
import { describe, expect, it } from 'vitest'

import { loadAsyncApiDocument } from './load-asyncapi-document'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'load-aas-'))

const YAML_DOCUMENT = [
  'asyncapi: 2.6.0',
  'info:',
  '  title: Test',
  '  version: 1.0.0',
  'channels:',
  '  events:',
  '    publish:',
  '      message:',
  '        name: evt',
  '        payload:',
  '          type: object',
  '',
].join('\n')

describe('load-asyncapi-document', () => {
  it('parses a YAML document', async () => {
    const dir = tmp()
    const file = join(dir, 'api.yaml')
    writeFileSync(file, YAML_DOCUMENT)
    const document = (await loadAsyncApiDocument({}, file)) as Record<string, unknown>
    // YAML 1.2 core schema: the version stays a string.
    expect(document['asyncapi']).toBe('2.6.0')
    expect(document['channels']).toBeDefined()
  })

  it('parses a JSON document', async () => {
    const dir = tmp()
    const file = join(dir, 'api.json')
    writeFileSync(file, JSON.stringify({ asyncapi: '3.0.0', info: { title: 'T', version: '1.0.0' }, channels: {} }))
    const document = (await loadAsyncApiDocument({}, file)) as Record<string, unknown>
    expect(document['asyncapi']).toBe('3.0.0')
  })

  it('reports YAML parse problems instead of generating from the salvage', async () => {
    const dir = tmp()
    const file = join(dir, 'broken.yaml')
    writeFileSync(file, 'asyncapi: 2.6.0\nchannels:\n  bad: [unclosed\n')
    await expect(loadAsyncApiDocument({}, file)).rejects.toThrow(/Failed to parse .*broken\.yaml as YAML/)
  })

  it('refuses a multi-document YAML stream instead of generating from its first document', async () => {
    const dir = tmp()
    const file = join(dir, 'multi.yaml')
    writeFileSync(file, `${YAML_DOCUMENT}---\nasyncapi: 2.6.0\ninfo: { title: Second, version: '1' }\n`)
    await expect(loadAsyncApiDocument({}, file)).rejects.toThrow(/multiple YAML documents/)
  })

  it('inlines a cross-file $ref within the document directory', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'payload.json'), JSON.stringify({ type: 'object', properties: { id: { type: 'string' } } }))
    const file = join(dir, 'api.yaml')
    writeFileSync(
      file,
      [
        'asyncapi: 2.6.0',
        'info: { title: T, version: 1.0.0 }',
        'channels:',
        '  events:',
        '    publish:',
        '      message:',
        '        name: evt',
        '        payload:',
        "          $ref: './payload.json'",
        '',
      ].join('\n'),
    )
    const document = (await loadAsyncApiDocument({}, file)) as Record<string, unknown>
    const payload = JSON.stringify(document)
    expect(payload).not.toContain('payload.json')
    expect(payload).toContain('"id"')
  })

  it('parses a BOM-prefixed JSON document', async () => {
    const dir = tmp()
    const file = join(dir, 'bom.json')
    // A Windows-saved file: EF BB BF, which utf-8 readFile keeps and
    // JSON.parse rejects with an error naming an invisible character.
    const byteOrderMark = String.fromCharCode(0xfeff)
    writeFileSync(
      file,
      byteOrderMark + JSON.stringify({ asyncapi: '3.0.0', info: { title: 'T', version: '1.0.0' }, channels: {} }),
    )
    const document = (await loadAsyncApiDocument({}, file)) as Record<string, unknown>
    expect(document['asyncapi']).toBe('3.0.0')
  })

  it('keeps operation channel identity through cross-file resolution', async () => {
    // The resolver inlines the operation's internal `channel: {$ref:
    // '#/channels/events'}` as a fresh copy while rebuilding the channels map
    // structurally — two different objects for one node, which broke the
    // extractor's identity matching (its only tool once the `$ref` strings
    // are gone) and silently dropped every direction whenever the document
    // carried a single cross-file ref.
    const dir = tmp()
    writeFileSync(join(dir, 'payload.json'), JSON.stringify({ type: 'object', properties: { id: { type: 'string' } } }))
    const file = join(dir, 'api.yaml')
    writeFileSync(
      file,
      [
        'asyncapi: 3.0.0',
        'info: { title: T, version: 1.0.0 }',
        'channels:',
        '  events:',
        '    messages:',
        '      evt:',
        '        payload:',
        "          $ref: './payload.json'",
        'operations:',
        '  sendEvt:',
        '    action: send',
        "    channel: { $ref: '#/channels/events' }",
        '',
      ].join('\n'),
    )
    const document = (await loadAsyncApiDocument({}, file)) as Record<string, unknown>
    const channels = document['channels'] as Record<string, unknown>
    const operations = document['operations'] as Record<string, Record<string, unknown>>
    expect(operations['sendEvt']?.['channel']).toBe(channels['events'])

    const model = extractAsyncApi(document)
    expect(model.channels[0]?.messages[0]?.direction).toBe('send')
    expect(model.issues).toEqual([])
  })

  it('refuses a cross-file $ref escaping the document directory', async () => {
    const dir = tmp()
    const outside = tmp()
    writeFileSync(join(outside, 'secret.json'), JSON.stringify({ type: 'object' }))
    const file = join(dir, 'api.yaml')
    writeFileSync(
      file,
      [
        'asyncapi: 2.6.0',
        'info: { title: T, version: 1.0.0 }',
        'channels:',
        '  events:',
        '    publish:',
        '      message:',
        `        payload: { $ref: '${join(outside, 'secret.json')}' }`,
        '',
      ].join('\n'),
    )
    await expect(loadAsyncApiDocument({}, file)).rejects.toThrow(/Failed to resolve \$refs/)
  })
})
