import { describe, expect, it } from 'vitest'

import { effect, signal } from './signals'
import { untrack } from './untrack'

describe('untrack', () => {
  it('returns whatever the getter returns', () => {
    const count = signal(7)

    expect(untrack(() => count())).toBe(7)
    expect(untrack(() => 'plain')).toBe('plain')
  })

  it('keeps a read inside it out of the surrounding effect dependencies', () => {
    // The classic case: an effect that should re-run when the query changes but
    // which also needs the current page size to build the request. Without the
    // escape hatch it would fire on every page-size change as well.
    const query = signal('a')
    const pageSize = signal(10)
    const requests: string[] = []

    effect(() => {
      requests.push(`${query()}:${untrack(() => pageSize())}`)
    })

    pageSize(20)
    expect(requests).toEqual(['a:10'])

    query('b')
    expect(requests).toEqual(['a:10', 'b:20'])
  })

  it('leaves reads outside it tracked as usual', () => {
    const tracked = signal(0)
    const hidden = signal(0)
    let runs = 0

    effect(() => {
      runs++
      tracked()
      untrack(() => hidden())
    })

    hidden(1)
    expect(runs).toBe(1)

    tracked(1)
    expect(runs).toBe(2)
  })

  it('restores tracking for reads that follow it in the same effect', () => {
    const before = signal(0)
    const after = signal(0)
    let runs = 0

    effect(() => {
      runs++
      untrack(() => before())
      after()
    })

    after(1)

    expect(runs).toBe(2)
  })

  it('restores the previous owner even when the getter throws', () => {
    // The suspension is undone in a `finally`, so a throw inside must not leave
    // the whole reactive graph detached for everything that runs after it.
    const count = signal(0)
    let runs = 0

    expect(() =>
      untrack(() => {
        throw new Error('boom')
      }),
    ).toThrow('boom')

    effect(() => {
      runs++
      count()
    })
    count(1)

    expect(runs).toBe(2)
  })
})
