import { describe, expect, it } from 'vitest'

import { batch, signal } from './signals'
import { watch } from './watch'

describe('watch', () => {
  it('does not fire on the initial run', () => {
    const count = signal(0)
    const calls: number[] = []
    // A signal can be passed straight to watch — no `() => count()` wrapper —
    // because Signal's setter-first typing lets T infer from the getter.
    watch(count, (value) => calls.push(value))
    expect(calls).toEqual([])
  })

  it('fires with new and previous values on change', () => {
    const count = signal(0)
    const calls: [number, number][] = []
    watch(count, (value, previous) => calls.push([value, previous]))
    count(1)
    count(5)
    expect(calls).toEqual([
      [1, 0],
      [5, 1],
    ])
  })

  it('skips writes that produce an equal tracked value', () => {
    const count = signal(0)
    const calls: boolean[] = []
    // Tracking a derived boolean: many writes map to the same value, and the
    // callback must only fire when the boolean actually flips.
    watch(
      () => count() > 0,
      (open) => calls.push(open),
    )
    count(1)
    count(2)
    count(3)
    count(0)
    expect(calls).toEqual([true, false])
  })

  it('coalesces batched writes into one callback', () => {
    const a = signal(1)
    const b = signal(2)
    const calls: number[] = []
    watch(
      () => a() + b(),
      (sum) => calls.push(sum),
    )
    batch(() => {
      a(10)
      b(20)
    })
    expect(calls).toEqual([30])
  })

  it('runs immediately with undefined previous when immediate is set', () => {
    const count = signal(3)
    const calls: [number, number | undefined][] = []
    watch(count, (value, previous) => calls.push([value, previous]), { immediate: true })
    // Fires once up front; the first call has no previous value.
    expect(calls).toEqual([[3, undefined]])
    count(4)
    expect(calls).toEqual([
      [3, undefined],
      [4, 3],
    ])
  })

  it('stops firing after the returned stop function is called', () => {
    const count = signal(0)
    const calls: number[] = []
    const stop = watch(count, (value) => calls.push(value))
    count(1)
    stop()
    count(2)
    expect(calls).toEqual([1])
  })

  it('does not track signals the callback reads', () => {
    // The callback reads `other`, but only `count` should drive the watcher —
    // otherwise writing `other` would re-fire the callback on an unrelated change.
    const count = signal(0)
    const other = signal('a')
    const calls: string[] = []
    watch(count, () => calls.push(other()))
    count(1)
    expect(calls).toEqual(['a'])
    // Writing the signal only read inside the callback must not re-fire it.
    other('b')
    expect(calls).toEqual(['a'])
  })

  it('does not track callback reads on the immediate run either', () => {
    const count = signal(0)
    const other = signal('a')
    let runs = 0
    watch(
      count,
      () => {
        runs += 1
        other()
      },
      { immediate: true },
    )
    expect(runs).toBe(1)
    other('b')
    expect(runs).toBe(1)
  })
})
