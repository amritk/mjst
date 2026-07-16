import { describe, expect, it } from 'vitest'

import { buildCoercionPlan } from './build-coercion-plan'

describe('build-coercion-plan', () => {
  it('plans number and integer properties as number coercions', () => {
    const plan = buildCoercionPlan({
      type: 'object',
      properties: { age: { type: 'integer' }, score: { type: 'number' } },
    })
    expect(plan.get('age')).toBe('number')
    expect(plan.get('score')).toBe('number')
  })

  it('plans boolean properties', () => {
    const plan = buildCoercionPlan({ type: 'object', properties: { active: { type: 'boolean' } } })
    expect(plan.get('active')).toBe('boolean')
  })

  it('plans typed arrays by item type', () => {
    const plan = buildCoercionPlan({
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'integer' } },
        flags: { type: 'array', items: { type: 'boolean' } },
        tags: { type: 'array', items: { type: 'string' } },
      },
    })
    expect(plan.get('ids')).toBe('number-array')
    expect(plan.get('flags')).toBe('boolean-array')
    expect(plan.get('tags')).toBe('string-array')
  })

  it('leaves string and untyped properties out of the plan', () => {
    const plan = buildCoercionPlan({
      type: 'object',
      properties: { name: { type: 'string' }, anything: {} },
    })
    expect(plan.size).toBe(0)
  })

  it('handles schemas without properties', () => {
    expect(buildCoercionPlan({ type: 'object' }).size).toBe(0)
    expect(buildCoercionPlan(true).size).toBe(0)
    expect(buildCoercionPlan(undefined).size).toBe(0)
  })
})
