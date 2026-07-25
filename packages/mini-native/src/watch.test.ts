import { describe, expect, it } from 'vitest'

import { signal } from './signals'
import { watch } from './watch'

describe('watch', () => {
  it('does not run the callback during setup', () => {
    // The change-only default is the whole reason this exists. Pushing a screen
    // when a route changes, or firing a request when a query is edited, is
    // wrong if it also happens once while the app is still booting.
    const route = signal('/home')
    const seen: string[] = []

    watch(route, (value) => seen.push(value))

    expect(seen).toEqual([])
  })

  it('runs the callback with the new and previous values on a change', () => {
    const route = signal('/home')
    const seen: [string, string][] = []

    watch(route, (value, previous) => seen.push([value, previous]))
    route('/settings')

    expect(seen).toEqual([['/settings', '/home']])
  })

  it('carries the previous value forward across several changes', () => {
    const count = signal(0)
    const seen: [number, number][] = []

    watch(count, (value, previous) => seen.push([value, previous]))
    count(1)
    count(2)
    count(3)

    expect(seen).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
    ])
  })

  it('runs once during setup when asked, with no previous value', () => {
    const route = signal('/home')
    const seen: [string, string | undefined][] = []

    watch(route, (value, previous) => seen.push([value, previous]), { immediate: true })

    expect(seen).toEqual([['/home', undefined]])
  })

  it('still fires on later changes after an immediate run', () => {
    const route = signal('/home')
    const seen: string[] = []

    watch(route, (value) => seen.push(value), { immediate: true })
    route('/settings')

    expect(seen).toEqual(['/home', '/settings'])
  })

  it('skips a write that leaves the value unchanged', () => {
    const count = signal(1)
    let runs = 0

    watch(count, () => {
      runs++
    })
    count(1)
    count(1)

    expect(runs).toBe(0)
  })

  it('treats two NaNs as unchanged, the way Object.is does', () => {
    // A plain `!==` comparison would call this a change on every write, which
    // is the one place `Object.is` and equality genuinely disagree.
    const value = signal(Number.NaN)
    let runs = 0

    watch(value, () => {
      runs++
    })
    value(Number.NaN)

    expect(runs).toBe(0)
  })

  it('treats a new object identity as a change', () => {
    // Values are compared by identity, so `get` should return a primitive or a
    // stable reference — an equal-looking new object counts as a change.
    const user = signal({ name: 'sam' })
    let runs = 0

    watch(user, () => {
      runs++
    })
    user({ name: 'sam' })

    expect(runs).toBe(1)
  })

  it('runs the callback untracked so a signal it reads cannot re-fire it', () => {
    // This is the guarantee that lets a callback consult or write other state
    // freely. Without it, reading `pageSize` inside the callback subscribes the
    // WATCHER to it, and the watcher then wakes up on every unrelated page-size
    // change. The wasted wake-up is what this counts: only `get` is tracked, so
    // it must not be re-evaluated for a signal only the callback touched.
    const query = signal('a')
    const pageSize = signal(10)
    let reads = 0
    let runs = 0

    watch(
      () => {
        reads++
        return query()
      },
      () => {
        runs++
        pageSize()
      },
    )

    query('b')
    expect(runs).toBe(1)
    const settled = reads

    pageSize(20)
    expect(reads).toBe(settled)
    expect(runs).toBe(1)
  })

  it('does not loop when the callback writes a signal it also reads', () => {
    const source = signal(0)
    const log = signal<number[]>([])
    let runs = 0

    watch(source, (value) => {
      runs++
      log([...log(), value])
    })
    source(1)

    expect(runs).toBe(1)
    expect(log()).toEqual([1])
  })

  it('runs the immediate callback untracked too', () => {
    // The immediate run happens inside the very first evaluation, where a
    // tracked read would be picked up most easily of all.
    const route = signal('/home')
    const locale = signal('en')
    let reads = 0
    let runs = 0

    watch(
      () => {
        reads++
        return route()
      },
      () => {
        runs++
        locale()
      },
      { immediate: true },
    )

    expect(runs).toBe(1)
    const settled = reads

    locale('fr')
    expect(reads).toBe(settled)
    expect(runs).toBe(1)
  })

  it('stops watching once the returned dispose is called', () => {
    const route = signal('/home')
    let runs = 0

    const stop = watch(route, () => {
      runs++
    })
    stop()
    route('/settings')

    expect(runs).toBe(0)
  })
})
