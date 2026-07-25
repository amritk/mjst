import { afterEach, describe, expect, it } from 'vitest'

import type { Host } from '../host'
import { createMemoryHost, type MemoryElement } from '../hosts/create-memory-host'
import { dispatchMemoryEvent } from '../hosts/dispatch-memory-event'
import { clearHost, effectScope, setHost, signal } from '../index'
import type { HostElement } from '../types'
import { bindValue } from './bind-value'

afterEach(() => {
  clearHost()
})

describe('bind-value', () => {
  it('writes the signal value onto the element during setup', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const input = memory.host.createElement('input')

    bindValue(input, signal('hello'))

    expect(asElement(input).props['value']).toBe('hello')
  })

  it('follows the signal downwards as it changes', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const model = signal('before')
    const input = memory.host.createElement('input')

    bindValue(input, model)
    model('after')

    expect(asElement(input).props['value']).toBe('after')
  })

  it('writes the signal back when the element reports input', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const model = signal('')
    const input = memory.host.createElement('input')

    bindValue(input, model)
    type(input, 'typed')

    expect(model()).toBe('typed')
  })

  it('reads an absent element value back as an empty string', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const model = signal('hello')
    const input = memory.host.createElement('input')
    bindValue(input, model)

    // Clearing a control leaves nothing behind on some targets, and the signal
    // has to end up as a string either way rather than as `undefined`.
    delete asElement(input).props['value']
    dispatchMemoryEvent(asElement(input), 'input')

    expect(model()).toBe('')
  })

  it('does not echo the character the user just typed back onto the element', () => {
    // Writing the value back when it already matches repositions the caret to
    // the end of the field, so a word typed in the middle of existing text
    // scatters. The inequality guard is what keeps typing feeling normal.
    const memory = createMemoryHost()
    const counter = countingWrites(memory.host)
    setHost(counter.host)
    const model = signal('')
    const input = memory.host.createElement('input')
    bindValue(input, model)

    counter.reset()
    type(input, 'ab')

    expect(model()).toBe('ab')
    expect(counter.writes()).toBe(0)
  })

  it('still writes the element when the signal changes from elsewhere', () => {
    // The other half of the guard: it must suppress only the echo, never a
    // genuine programmatic change.
    const memory = createMemoryHost()
    const counter = countingWrites(memory.host)
    setHost(counter.host)
    const model = signal('')
    const input = memory.host.createElement('input')
    bindValue(input, model)

    counter.reset()
    model('reset by the app')

    expect(counter.writes()).toBe(1)
    expect(asElement(input).props['value']).toBe('reset by the app')
  })

  it('holds the signal still while an IME composition is in flight', () => {
    // An IME emits input events for every intermediate candidate while
    // composing CJK or accented text. Writing those through would tear the
    // candidate string apart, so nothing is committed until composition ends.
    const memory = createMemoryHost()
    setHost(memory.host)
    const model = signal('')
    const input = memory.host.createElement('input')
    bindValue(input, model)

    dispatchMemoryEvent(asElement(input), 'compositionstart')
    type(input, 'にほn')

    expect(model()).toBe('')
  })

  it('commits the composed text once the composition ends', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const model = signal('')
    const input = memory.host.createElement('input')
    bindValue(input, model)

    dispatchMemoryEvent(asElement(input), 'compositionstart')
    type(input, 'にほn')
    asElement(input).props['value'] = 'にほん'
    dispatchMemoryEvent(asElement(input), 'compositionend')

    expect(model()).toBe('にほん')
  })

  it('leaves the element alone while a composition is in flight', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const model = signal('')
    const input = memory.host.createElement('input')
    bindValue(input, model)

    dispatchMemoryEvent(asElement(input), 'compositionstart')
    asElement(input).props['value'] = 'partial'
    model('written by the app')

    expect(asElement(input).props['value']).toBe('partial')
  })

  it('applies a write that arrived mid-composition once the composition ends', () => {
    // The element is deliberately left alone during a composition, but the write
    // must not be lost with it. Reading the element back instead would make the
    // model agree with the element again, leaving the tracking effect nothing to
    // re-apply — and the app's write would vanish without trace.
    const memory = createMemoryHost()
    setHost(memory.host)
    const model = signal('')
    const input = memory.host.createElement('input')
    bindValue(input, model)

    dispatchMemoryEvent(asElement(input), 'compositionstart')
    asElement(input).props['value'] = 'partial'
    model('cleared by the app')
    dispatchMemoryEvent(asElement(input), 'compositionend')

    expect(asElement(input).props['value']).toBe('cleared by the app')
    expect(model()).toBe('cleared by the app')
  })

  it('resumes composing after the composition ends', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const model = signal('')
    const input = memory.host.createElement('input')
    bindValue(input, model)

    dispatchMemoryEvent(asElement(input), 'compositionstart')
    dispatchMemoryEvent(asElement(input), 'compositionend')
    type(input, 'plain')

    expect(model()).toBe('plain')
  })

  it('detaches all three listeners when the enclosing scope is disposed', () => {
    // The documented way to reach this binding is from a `ref`, where the
    // returned dispose is never called by hand and teardown is left entirely to
    // the scope. The listeners used to survive that, leaving a dispatcher the
    // engine keeps calling for an element nobody can see.
    const memory = createMemoryHost()
    setHost(memory.host)
    const input = memory.host.createElement('input')

    const dispose = effectScope(() => {
      bindValue(input, signal(''))
    })
    expect(listenerCount(input)).toBe(3)

    dispose()

    expect(listenerCount(input)).toBe(0)
  })

  it('detaches the listeners when the returned dispose is called by hand', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const input = memory.host.createElement('input')

    const dispose = bindValue(input, signal(''))
    dispose()

    expect(listenerCount(input)).toBe(0)
  })

  it('survives being disposed by hand and by the scope', () => {
    // Both paths can legitimately fire for the same binding, and an effect's
    // cleanup runs at most once, so doing both has to be harmless.
    const memory = createMemoryHost()
    setHost(memory.host)
    const input = memory.host.createElement('input')
    // effectScope runs its body synchronously, so the assignment is definite —
    // just invisible to the compiler, hence the non-null claim.
    let byHand!: () => void

    const disposeScope = effectScope(() => {
      byHand = bindValue(input, signal(''))
    })

    expect(() => {
      byHand()
      disposeScope()
    }).not.toThrow()
    expect(listenerCount(input)).toBe(0)
  })

  it('stops following the signal once disposed', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const model = signal('before')
    const input = memory.host.createElement('input')

    const dispose = bindValue(input, model)
    dispose()
    model('after')

    expect(asElement(input).props['value']).toBe('before')
  })
})

/** The in-memory element behind an opaque handle. */
const asElement = (element: HostElement): MemoryElement => element as unknown as MemoryElement

/**
 * Simulates a user typing: the control already holds the new text by the time
 * it reports the change, which is exactly the order a real target delivers.
 */
const type = (element: HostElement, value: string): void => {
  asElement(element).props['value'] = value
  dispatchMemoryEvent(asElement(element), 'input')
}

/** Every handler still attached to an element, across all event names. */
const listenerCount = (element: HostElement): number => {
  let total = 0
  for (const handlers of asElement(element).listeners.values()) total += handlers.size
  return total
}

/**
 * Wraps a host so a test can count property writes.
 *
 * Asserting on the value alone cannot see the caret bug: the element ends up
 * holding the right text either way, and the damage is that it was written at
 * all. Counting the writes is the only way to say so.
 */
const countingWrites = (host: Host): { host: Host; writes: () => number; reset: () => void } => {
  let writes = 0
  return {
    writes: () => writes,
    reset: () => {
      writes = 0
    },
    host: {
      ...host,
      setProperty: (element, name, value) => {
        if (name === 'value') writes++
        host.setProperty(element, name, value)
      },
    },
  }
}
