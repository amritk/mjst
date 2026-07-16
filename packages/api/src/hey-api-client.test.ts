import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@hey-api/openapi-ts'
import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { defineRoute } from './define-route'

/**
 * Integration test for the typed-client story: the document `toOpenApi`
 * produces must be valid Hey API (openapi-ts) input, and the generated SDK
 * must carry the contract's types — path params coerced, headers required,
 * bodies shaped. This is the replacement for framework-coupled RPC clients
 * (Hono's `hc`): the client is generated from the same schemas that validate
 * requests, so it cannot drift either.
 */

const getUser = defineRoute({
  method: 'get',
  path: '/users/{id}',
  operationId: 'getUser',
  request: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
  responses: {
    200: {
      body: {
        type: 'object',
        properties: { id: { type: 'integer' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
    },
    404: {},
  },
  handler: ({ params }) => ({ status: 200, body: { id: params.id, name: 'Ada' } }),
})

const chat = defineRoute({
  method: 'post',
  path: '/chat',
  operationId: 'chat',
  request: {
    body: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    headers: { type: 'object', properties: { 'x-api-key': { type: 'string' } }, required: ['x-api-key'] },
  },
  responses: { 200: { contentType: 'text/plain; charset=utf-8' } },
  handler: () => ({ status: 200, body: 'ok' }),
})

describe('hey-api-client', () => {
  it('generates a typed fetch client from the OpenAPI document', async () => {
    const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '.hey-api-fixtures')
    mkdirSync(fixtureDir, { recursive: true })
    try {
      const api = createApi({ routes: [getUser, chat], info: { title: 'Client Test', version: '1.0.0' } })
      const specPath = join(fixtureDir, 'openapi.json')
      writeFileSync(specPath, JSON.stringify(api.openApi()))

      await createClient({
        input: specPath,
        output: { path: join(fixtureDir, 'client') },
        logs: { level: 'silent' },
      })

      const types = readFileSync(join(fixtureDir, 'client', 'types.gen.ts'), 'utf8')
      // Path parameters keep their schema types.
      expect(types).toMatch(/path:\s*\{\s*id:\s*number;?\s*\}/)
      // The contract's response schema flows into the client verbatim.
      expect(types).toContain('name: string')
      // Contract-declared request headers become required client inputs.
      expect(types).toMatch(/headers:\s*\{\s*'x-api-key':\s*string;?\s*\}/)
      // The declared 404 shows up as a typed error variant.
      expect(types).toMatch(/GetUserErrors = \{[^}]*404/)

      const sdk = readFileSync(join(fixtureDir, 'client', 'sdk.gen.ts'), 'utf8')
      // One SDK function per operationId, bound to the contract's path.
      expect(sdk).toContain('export const getUser =')
      expect(sdk).toContain("url: '/users/{id}'")
      expect(sdk).toContain('export const chat =')
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  }, 30000)
})
