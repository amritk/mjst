import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryHost, type MemoryElement } from '../hosts/create-memory-host'
import { serializeMemoryTree } from '../hosts/serialize-memory-tree'
import { clearHost, mount, onCleanup, setHost, signal } from '../index'
import { Show } from './show'

afterEach(() => {
  clearHost()
})

describe('show', () => {
  it('renders the children branch while the condition is truthy', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const open = signal(true)

    mount(memory.rootElement, () => <Show when={open}>{() => <text>open</text>}</Show>)

    expect(serializeMemoryTree(memory.root)).toContain('"open"')
  })

  it('swaps to the fallback when the condition goes falsy', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const open = signal(true)

    mount(memory.rootElement, () => (
      <Show when={open} fallback={() => <text>closed</text>}>
        {() => <text>open</text>}
      </Show>
    ))

    open(false)

    const tree = serializeMemoryTree(memory.root)
    expect(tree).toContain('"closed"')
    expect(tree).not.toContain('"open"')
  })

  it('renders nothing when falsy and no fallback is given', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const open = signal(false)

    mount(memory.rootElement, () => <Show when={open}>{() => <text>open</text>}</Show>)

    // The wrapper element still exists; it is simply empty.
    const wrapper = memory.root.children[0] as MemoryElement
    expect(wrapper.children).toHaveLength(0)
  })

  it('switches on truthiness rather than a strict boolean', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const user = signal<{ name: string } | null>(null)

    mount(memory.rootElement, () => (
      <Show when={user} fallback={() => <text>anonymous</text>}>
        {() => <text>signed in</text>}
      </Show>
    ))

    expect(serializeMemoryTree(memory.root)).toContain('"anonymous"')
    user({ name: 'sam' })
    expect(serializeMemoryTree(memory.root)).toContain('"signed in"')
  })

  it('tears the hidden branch down so it stops reacting', () => {
    // This is the difference between `Show` and the `show` prop: `show` hides
    // an element that keeps running, while `Show` removes the subtree outright.
    const memory = createMemoryHost()
    setHost(memory.host)
    const open = signal(true)
    let cleaned = false

    mount(memory.rootElement, () => (
      <Show when={open}>
        {() => {
          onCleanup(() => {
            cleaned = true
          })
          return <text>open</text>
        }}
      </Show>
    ))

    expect(cleaned).toBe(false)
    open(false)
    expect(cleaned).toBe(true)
  })
})
