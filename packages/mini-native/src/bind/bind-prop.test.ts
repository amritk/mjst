import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryHost, type MemoryElement } from '../hosts/create-memory-host'
import { clearHost, effectScope, setHost, signal } from '../index'
import type { HostElement } from '../types'
import { bindProp } from './bind-prop'

afterEach(() => {
  clearHost()
})

describe('bind-prop', () => {
  it('writes the property during setup', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const input = memory.host.createElement('input')

    bindProp(input, 'placeholder', () => 'your name')

    expect(propsOf(input)['placeholder']).toBe('your name')
  })

  it('rewrites the property whenever the signal changes', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const placeholder = signal('before')
    const input = memory.host.createElement('input')

    bindProp(input, 'placeholder', placeholder)
    placeholder('after')

    expect(propsOf(input)['placeholder']).toBe('after')
  })

  it('unsets the property when the value turns into an unset sentinel', () => {
    // `false`, `null`, and `undefined` all mean "unset it", which is what lets
    // this one helper cover boolean props like `disabled` without a second
    // binding that knows about attribute presence.
    const memory = createMemoryHost()
    setHost(memory.host)
    const disabled = signal<unknown>(true)
    const input = memory.host.createElement('input')

    bindProp(input, 'disabled', disabled)
    expect(propsOf(input)['disabled']).toBe(true)

    for (const sentinel of [false, null, undefined]) {
      disabled(true)
      disabled(sentinel)
      expect('disabled' in propsOf(input)).toBe(false)
    }
  })

  it('stops updating once the returned dispose is called', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const placeholder = signal('before')
    const input = memory.host.createElement('input')

    const dispose = bindProp(input, 'placeholder', placeholder)
    dispose()
    placeholder('after')

    expect(propsOf(input)['placeholder']).toBe('before')
  })

  it('stops updating when the enclosing scope is disposed', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const placeholder = signal('before')
    const input = memory.host.createElement('input')

    const dispose = effectScope(() => {
      bindProp(input, 'placeholder', placeholder)
    })
    dispose()
    placeholder('after')

    expect(propsOf(input)['placeholder']).toBe('before')
  })
})

/** The property bag behind an opaque element handle. */
const propsOf = (element: HostElement): Record<string, unknown> => (element as unknown as MemoryElement).props
