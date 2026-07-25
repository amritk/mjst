import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryHost, type MemoryElement } from './hosts/create-memory-host'
import { clearHost, setHost } from './index'
import { toFactory } from './to-factory'
import type { HostElement } from './types'

/**
 * The two branch forms behave differently on purpose, and the difference is the
 * whole reason a caller picks one over the other — so it is worth proving
 * rather than trusting the doc comment.
 */

afterEach(() => {
  clearHost()
})

describe('to-factory', () => {
  it('does not build anything until a function branch is entered', () => {
    let builds = 0
    const memory = createMemoryHost()
    setHost(memory.host)

    const factory = toFactory(() => {
      builds++
      return memory.host.createElement('view')
    })

    expect(builds).toBe(0)
    factory()
    expect(builds).toBe(1)
  })

  it('rebuilds a function branch on every entry, so its state resets', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const factory = toFactory(() => memory.host.createElement('input'))

    const first = factory()
    // Stand-in for whatever state a real branch would hold — a half-typed
    // value, a scroll offset. Re-entering the branch has to lose it.
    asElement(first).props['value'] = 'half typed'
    const second = factory()

    expect(second).not.toBe(first)
    expect('value' in asElement(second).props).toBe(false)
  })

  it('reattaches the same node every time in the element form, so state survives', () => {
    // The reason the eager form exists: a branch that is expensive to rebuild,
    // or that holds something worth keeping, is built once and reused.
    const memory = createMemoryHost()
    setHost(memory.host)
    const built = memory.host.createElement('input')
    const factory = toFactory(built)

    const first = factory()
    asElement(first).props['value'] = 'half typed'
    const second = factory()

    expect(second).toBe(built)
    expect(asElement(second).props['value']).toBe('half typed')
  })
})

/** The in-memory element behind an opaque handle. */
const asElement = (element: HostElement): MemoryElement => element as unknown as MemoryElement
