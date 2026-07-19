import { describe, expect, it } from 'vitest'

import { collectRouteContracts } from './collect-route-contracts'

const contract = {
  method: 'get',
  path: '/health',
  responses: { 200: { body: { type: 'object' } } },
}

describe('collect-route-contracts', () => {
  it('collects exports that declare method, path, and responses', () => {
    const routes = collectRouteContracts({ health: contract, other: { ...contract, path: '/other' } })
    expect(Object.keys(routes)).toEqual(['health', 'other'])
  })

  it('ignores exports missing any contract field', () => {
    const routes = collectRouteContracts({
      schema: { type: 'object' },
      makeContext: () => ({}),
      noResponses: { method: 'get', path: '/x' },
      noPath: { method: 'get', responses: {} },
      value: 42,
      nothing: null,
    })
    expect(routes).toEqual({})
  })

  it('skips the default export even when it looks like a contract', () => {
    // `default` cannot be re-imported by name in the generated module.
    const routes = collectRouteContracts({ default: contract, health: contract })
    expect(Object.keys(routes)).toEqual(['health'])
  })
})
