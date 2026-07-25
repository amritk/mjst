import { afterEach, describe, expect, it } from 'vitest'

import { applyProp } from './apply-prop'
import { createMemoryHost, type MemoryElement } from './hosts/create-memory-host'
import { dispatchMemoryEvent } from './hosts/dispatch-memory-event'
import { clearHost, setHost, signal } from './index'
import type { HostElement } from './types'

/**
 * `applyProp` is where the compilerless reactivity rule actually lives: a
 * function-valued prop tracks and anything else is applied once. Every prop kind
 * makes that decision for itself, so each one is pinned separately here — a
 * regression in any single branch would otherwise hide behind the others.
 */

afterEach(() => {
  clearHost()
})

describe('apply-prop', () => {
  it('applies a static show once', () => {
    // A plain boolean still goes through the visibility binding, so the two
    // forms of `show` cannot drift apart in behaviour.
    const view = setup()

    applyProp(view, 'show', false)

    expect(asElement(view).visible).toBe(false)
  })

  it('tracks a show getter', () => {
    const view = setup()
    const visible = signal(true)

    applyProp(view, 'show', visible)
    visible(false)

    expect(asElement(view).visible).toBe(false)
  })

  it('resolves a static class through the class value forms', () => {
    const view = setup()

    applyProp(view, 'class', ['card', false, 'wide'])

    expect(asElement(view).props['class']).toBe('card wide')
  })

  it('tracks a class getter and re-resolves it', () => {
    const view = setup()
    const active = signal(false)

    applyProp(view, 'class', () => ({ card: true, on: active() }))
    expect(asElement(view).props['class']).toBe('card')

    active(true)
    expect(asElement(view).props['class']).toBe('card on')
  })

  it('applies a static style bag once', () => {
    const view = setup()

    applyProp(view, 'style', { width: 10 })

    expect(asElement(view).style).toEqual({ width: 10 })
  })

  it('clears the style when a static value is nullish', () => {
    const view = setup()
    applyProp(view, 'style', { width: 10 })

    applyProp(view, 'style', undefined)

    expect(asElement(view).style).toBeNull()
  })

  it('tracks a style getter', () => {
    const view = setup()
    const width = signal(10)

    applyProp(view, 'style', () => ({ width: width() }))
    width(20)

    expect(asElement(view).style).toEqual({ width: 20 })
  })

  it('registers an on* handler under the lowercased, undecorated name', () => {
    // `onLongPress` reaches the host as `longpress`; mapping that onto the
    // target's own event system is the host's job, not the runtime's.
    const view = setup()
    const presses: number[] = []

    applyProp(view, 'onLongPress', () => presses.push(1))
    dispatchMemoryEvent(asElement(view), 'longpress')

    expect(presses).toHaveLength(1)
    expect([...asElement(view).listeners.keys()]).toEqual(['longpress'])
  })

  it('leaves an on* prop that is not a function off the listener path', () => {
    // The value check is what keeps `onTap={undefined}` from registering a
    // listener for a handler that does not exist. Anything non-callable is an
    // ordinary property instead, so nothing is silently swallowed.
    const view = setup()

    applyProp(view, 'onTap', 'not a handler')

    expect(listenerCount(view)).toBe(0)
    expect(asElement(view).props['onTap']).toBe('not a handler')
  })

  it('registers no listener for an on* prop that is undefined', () => {
    const view = setup()

    applyProp(view, 'onTap', undefined)

    expect(listenerCount(view)).toBe(0)
    expect('onTap' in asElement(view).props).toBe(false)
  })

  it('applies a plain static prop once and never again', () => {
    const view = setup()
    const placeholder = signal('before')

    // Calling the signal reads it once, which is the compilerless footgun. The
    // property must freeze at that value.
    applyProp(view, 'placeholder', placeholder())
    placeholder('after')

    expect(asElement(view).props['placeholder']).toBe('before')
  })

  it('tracks a plain function-valued prop', () => {
    const view = setup()
    const placeholder = signal('before')

    applyProp(view, 'placeholder', placeholder)
    placeholder('after')

    expect(asElement(view).props['placeholder']).toBe('after')
  })

  it('unsets a plain prop when its tracked value turns falsy', () => {
    const view = setup()
    const disabled = signal(true)

    applyProp(view, 'disabled', disabled)
    disabled(false)

    expect('disabled' in asElement(view).props).toBe(false)
  })
})

/** Installs a fresh memory host and hands back an element to apply props to. */
const setup = (): HostElement => {
  const memory = createMemoryHost()
  setHost(memory.host)
  return memory.host.createElement('view')
}

/** The in-memory element behind an opaque handle. */
const asElement = (element: HostElement): MemoryElement => element as unknown as MemoryElement

/** Every handler attached to an element, across all event names. */
const listenerCount = (element: HostElement): number => {
  let total = 0
  for (const handlers of asElement(element).listeners.values()) total += handlers.size
  return total
}
