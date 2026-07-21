import { describe, expect, it } from 'vitest'

import { onCleanup } from './on-cleanup'
import { effectScope } from './signals'

describe('on-cleanup', () => {
  it('runs the callback once when the enclosing scope is disposed', () => {
    const order: string[] = []
    const dispose = effectScope(() => {
      onCleanup(() => order.push('cleanup'))
      order.push('setup')
    })
    expect(order).toEqual(['setup'])
    dispose()
    expect(order).toEqual(['setup', 'cleanup'])
  })

  it('does not run before disposal', () => {
    let ran = false
    effectScope(() => {
      onCleanup(() => {
        ran = true
      })
    })
    // The scope handle is intentionally dropped: cleanup must wait for an
    // explicit dispose, not fire at the end of scope setup.
    expect(ran).toBe(false)
  })

  it('runs every registered cleanup in a scope', () => {
    const order: string[] = []
    const dispose = effectScope(() => {
      onCleanup(() => order.push('a'))
      onCleanup(() => order.push('b'))
    })
    dispose()
    expect(order.sort()).toEqual(['a', 'b'])
  })
})
