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

  it('hands the function child a getter for the narrowed value', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const user = signal<{ name: string } | null>({ name: 'sam' })

    mount(memory.rootElement, () => <Show when={user}>{(value) => <text>{() => value().name}</text>}</Show>)

    expect(serializeMemoryTree(memory.root)).toContain('"sam"')
  })

  it('updates the child through the getter without rebuilding the branch', () => {
    // The whole reason the child receives a getter rather than a raw value: a
    // truthy→truthy change has to flow into the existing branch, because
    // rebuilding it would drop whatever state it held — a focused input, say.
    const memory = createMemoryHost()
    setHost(memory.host)
    const user = signal<{ name: string } | null>({ name: 'sam' })
    let builds = 0
    let cleaned = false

    mount(memory.rootElement, () => (
      <Show when={user}>
        {(value) => {
          builds += 1
          onCleanup(() => {
            cleaned = true
          })
          return <text>{() => value().name}</text>
        }}
      </Show>
    ))

    expect(builds).toBe(1)
    user({ name: 'alex' })

    expect(serializeMemoryTree(memory.root)).toContain('"alex"')
    // Built once and never torn down: the branch survived the change.
    expect(builds).toBe(1)
    expect(cleaned).toBe(false)
  })

  it('keeps the last truthy value readable while the branch is torn down', () => {
    // Both the swap and the child's text binding depend on `when`, so on the way
    // to falsy the child can be read one last time. The getter answers with the
    // previous value instead of the falsy one, so `value().name` cannot throw
    // regardless of which effect runs first.
    const memory = createMemoryHost()
    setHost(memory.host)
    const user = signal<{ name: string } | null>({ name: 'sam' })

    mount(memory.rootElement, () => (
      <Show when={user} fallback={() => <text>anonymous</text>}>
        {(value) => <text>{() => value().name}</text>}
      </Show>
    ))

    expect(() => user(null)).not.toThrow()
    expect(serializeMemoryTree(memory.root)).toContain('"anonymous"')
  })
})
