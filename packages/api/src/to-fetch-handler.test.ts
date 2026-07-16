import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { defineRoute } from './define-route'
import { toFetchHandler } from './to-fetch-handler'

const echo = defineRoute({
  method: 'post',
  path: '/echo/{id}',
  request: {
    params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    query: { type: 'object', properties: { upper: { type: 'boolean' } } },
    body: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
  },
  responses: {
    200: { body: { type: 'object', properties: { id: {}, message: {} } } },
  },
  handler: ({ params, query, body }) => ({
    status: 200,
    body: { id: params.id, message: query.upper === true ? body.message.toUpperCase() : body.message },
  }),
})

const empty = defineRoute({
  method: 'delete',
  path: '/things/{id}',
  responses: { 204: {} },
  handler: () => ({ status: 204, headers: { 'x-deleted': 'yes' } }),
})

describe('to-fetch-handler', () => {
  const handler = toFetchHandler(createApi({ routes: [echo, empty] }))

  it('translates a Request through the pipeline and back to a Response', async () => {
    const response = await handler(
      new Request('http://localhost/echo/7?upper=true', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'hi' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ id: 7, message: 'HI' })
  })

  it('sends bodyless replies with custom headers and no content', async () => {
    const response = await handler(new Request('http://localhost/things/3', { method: 'DELETE' }))
    expect(response.status).toBe(204)
    expect(response.headers.get('x-deleted')).toBe('yes')
    expect(await response.text()).toBe('')
  })

  it('answers 400 for a malformed JSON body', async () => {
    const response = await handler(new Request('http://localhost/echo/7', { method: 'POST', body: 'not json' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_json' })
  })

  it('answers 404 for unknown paths', async () => {
    const response = await handler(new Request('http://localhost/missing'))
    expect(response.status).toBe(404)
  })

  it('serves the OpenAPI document', async () => {
    const response = await handler(new Request('http://localhost/openapi.json'))
    expect(response.status).toBe(200)
    const document = (await response.json()) as { openapi: string }
    expect(document.openapi).toBe('3.1.0')
  })
})
