import { defineRoute } from '../src/index.ts'

/**
 * The route contracts every benchmark case runs against — shared by the
 * runtime cases (`createApi`) and the compiled cases (`compileToModule`
 * imports this module wholesale, so it must export route contracts and
 * nothing else).
 */

const userBody = {
  type: 'object',
  properties: { id: { type: 'integer' }, name: { type: 'string' }, email: { type: 'string' } },
  required: ['id', 'name'],
} as const

export const health = defineRoute({
  method: 'get',
  path: '/health',
  responses: { 200: { body: { type: 'object', properties: { ok: { type: 'boolean' } } } } },
  handler: () => ({ status: 200, body: { ok: true } }),
})

export const getUser = defineRoute({
  method: 'get',
  path: '/users/{id}',
  request: {
    params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    query: { type: 'object', properties: { verbose: { type: 'boolean' } } },
  },
  responses: { 200: { body: userBody } },
  handler: ({ params }) => ({ status: 200, body: { id: params.id, name: 'Ada' } }),
})

export const createUser = defineRoute({
  method: 'post',
  path: '/users',
  request: { body: userBody },
  responses: { 201: { body: userBody } },
  handler: ({ body }) => ({ status: 201, body }),
})
