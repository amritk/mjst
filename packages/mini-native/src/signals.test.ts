import { describe, expect, it } from 'vitest'

import { batch, effect, signal } from './signals'

describe('signals', () => {
  it('reads with no argument and writes with one', () => {
    const count = signal(0)

    expect(count()).toBe(0)
    count(5)
    expect(count()).toBe(5)
  })

  it('collapses several writes in a batch into one effect run', () => {
    // Effects run synchronously on write, so updating five fields of a form
    // model re-runs every binding that reads any of them five times. On a
    // native target each of those runs is a call across the bridge.
    const first = signal('Ada')
    const last = signal('Lovelace')
    const rendered: string[] = []

    effect(() => {
      rendered.push(`${first()} ${last()}`)
    })
    rendered.length = 0

    batch(() => {
      first('Grace')
      last('Hopper')
    })

    expect(rendered).toEqual(['Grace Hopper'])
  })

  it('runs the same writes once each without a batch', () => {
    // The contrast is the point: the same two writes unbatched cost two runs,
    // which is what `batch` exists to avoid.
    const first = signal('Ada')
    const last = signal('Lovelace')
    const rendered: string[] = []

    effect(() => {
      rendered.push(`${first()} ${last()}`)
    })
    rendered.length = 0

    first('Grace')
    last('Hopper')

    expect(rendered).toEqual(['Grace Lovelace', 'Grace Hopper'])
  })

  it('holds propagation until the batch ends rather than dropping it', () => {
    const count = signal(0)
    const seen: number[] = []
    effect(() => {
      seen.push(count())
    })
    seen.length = 0

    batch(() => {
      count(1)
      count(2)
      // Nothing has propagated yet: the effect only runs once the batch closes.
      expect(seen).toEqual([])
    })

    expect(seen).toEqual([2])
  })

  it('closes the batch even when the body throws', () => {
    // The body runs in a `try`/`finally`, so a throw must not leave the graph
    // permanently batched — every write after it would silently stop notifying.
    const count = signal(0)
    const seen: number[] = []
    effect(() => {
      seen.push(count())
    })
    seen.length = 0

    expect(() =>
      batch(() => {
        count(1)
        throw new Error('boom')
      }),
    ).toThrow('boom')

    count(2)

    expect(seen).toContain(2)
  })

  it('reads the current value inside a batch even before it flushes', () => {
    const count = signal(0)
    let observed = -1

    batch(() => {
      count(3)
      observed = count()
    })

    expect(observed).toBe(3)
  })
})
