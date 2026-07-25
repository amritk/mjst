import { describe, expect, it } from 'vitest'

import { signal } from './signals'
import { toGetter } from './to-getter'

describe('to-getter', () => {
  it('wraps a static value so downstream code only ever sees a getter', () => {
    const get = toGetter('card')

    expect(get()).toBe('card')
    expect(get()).toBe('card')
  })

  it('passes a function through as the same reference', () => {
    // A signal already is a getter, so it must not be wrapped a second time —
    // that is what makes `when={isOpen}` track while `when={true}` stays a
    // constant, with no branching anywhere downstream.
    const source = (): number => 1

    expect(toGetter(source)).toBe(source)
  })

  it('keeps a signal live rather than snapshotting it', () => {
    const open = signal(false)

    const get = toGetter(open)
    open(true)

    expect(get()).toBe(true)
  })

  it('wraps nullish and false values rather than treating them as absent', () => {
    expect(toGetter(null)()).toBeNull()
    expect(toGetter(undefined)()).toBeUndefined()
    expect(toGetter(false)()).toBe(false)
  })
})
