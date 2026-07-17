import { describe, expect, it } from 'vitest'

import { defineContract } from './define-contract'

describe('define-contract', () => {
  it('returns the contract untouched — pure data, no handler', () => {
    const literal = {
      method: 'get',
      path: '/users/{id}',
      request: {
        params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      },
      responses: {
        200: { body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
        404: {},
      },
    } as const
    const contract = defineContract(literal)
    expect(contract).toBe(literal)
    expect('handler' in contract).toBe(false)
  })

  it('carries OpenAPI annotations and refine like a full route', () => {
    const contract = defineContract({
      method: 'post',
      path: '/slots',
      summary: 'Book a slot',
      deprecated: true,
      security: [{ bearerAuth: [] }],
      request: {
        body: {
          type: 'object',
          properties: { start: { type: 'integer' }, end: { type: 'integer' } },
          required: ['start', 'end'],
        },
      },
      refine: ({ body }) => (body.start < body.end ? undefined : [{ message: 'end must be after start' }]),
      responses: { 201: {} },
    })
    expect(contract.summary).toBe('Book a slot')
    // The refine input is typed from the schema literals: start is a number here.
    expect(
      contract.refine?.({
        params: undefined,
        query: undefined,
        body: { start: 2, end: 1 },
        headers: undefined,
        cookies: undefined,
      }),
    ).toEqual([{ message: 'end must be after start' }])
  })
})
