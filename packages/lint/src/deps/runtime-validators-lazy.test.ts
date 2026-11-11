import { describe, expect, it } from 'vitest'

import * as eager from './runtime-validators'
import * as lazy from './runtime-validators-lazy'

describe('runtime-validators-lazy', () => {
  it('exports what the eager module exports', () => {
    expect(Object.keys(lazy).sort()).toEqual(Object.keys(eager).sort())
  })

  // A synchronous caller can come first, with nothing preloaded: `schema()`
  // called directly, outside any run.
  it('validates before anything has preloaded the module', () => {
    const validator = lazy.validate({ type: 'string' })

    expect(validator('ok')).toBe(true)
    expect(validator(1)).toMatchObject({ valid: false })
  })

  it('validates once preloaded', async () => {
    await lazy.preloadRuntimeValidators()

    expect(lazy.validate({ type: 'number' })(1)).toBe(true)
  })
})
