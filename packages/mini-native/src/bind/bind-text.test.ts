import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryHost, type MemoryText } from '../hosts/create-memory-host'
import { clearHost, effectScope, setHost, signal } from '../index'
import type { HostText } from '../types'
import { bindText } from './bind-text'

afterEach(() => {
  clearHost()
})

describe('bind-text', () => {
  it('writes the getter value into the node during setup', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const node = memory.host.createText('')

    bindText(node, () => 'hello')

    expect(textOf(node)).toBe('hello')
  })

  it('rewrites the node whenever the signal changes', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const label = signal('before')
    const node = memory.host.createText('')

    bindText(node, label)
    label('after')

    expect(textOf(node)).toBe('after')
  })

  it('stops updating once the returned dispose is called', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const label = signal('before')
    const node = memory.host.createText('')

    const dispose = bindText(node, label)
    dispose()
    label('after')

    expect(textOf(node)).toBe('before')
  })

  it('stops updating when the enclosing scope is disposed', () => {
    // A binding is normally created deep inside a component and never disposed
    // by hand, so scope teardown is the path that actually runs in an app.
    const memory = createMemoryHost()
    setHost(memory.host)
    const label = signal('before')
    const node = memory.host.createText('')

    const dispose = effectScope(() => {
      bindText(node, label)
    })
    dispose()
    label('after')

    expect(textOf(node)).toBe('before')
  })
})

/** The text behind an opaque node handle, which is all these cases assert on. */
const textOf = (node: HostText): string => (node as unknown as MemoryText).value
