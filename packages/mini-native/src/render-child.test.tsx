import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryHost } from './hosts/create-memory-host'
import { clearHost, onCleanup, renderChild, setHost, signal } from './index'
import type { HostElement } from './types'

afterEach(() => {
  clearHost()
})

describe('render-child', () => {
  it('builds the selected branch and swaps it when the selection changes', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const wrapper = memory.host.createFlowHost()
    const left = (): HostElement => memory.host.createElement('view')
    const right = (): HostElement => memory.host.createElement('image')
    const showLeft = signal(true)

    renderChild(wrapper, () => (showLeft() ? left : right))
    expect(tagOfOnlyChild(wrapper)).toBe('view')

    showLeft(false)
    expect(tagOfOnlyChild(wrapper)).toBe('image')
  })

  it('does not rebuild the branch when the condition changes without changing branch', () => {
    // This is the guarantee the `computed` in `renderChild` exists for. A
    // derived condition re-evaluates constantly while staying on one branch —
    // `count() > 5` from 6 to 7 — and rebuilding then would tear down a subtree
    // that did not logically change, losing focus and input state inside it and
    // paying a full teardown across the bridge for nothing.
    const memory = createMemoryHost()
    setHost(memory.host)
    const wrapper = memory.host.createFlowHost()
    const count = signal(6)
    let builds = 0
    let cleanups = 0
    const branch = (): HostElement => {
      builds++
      onCleanup(() => {
        cleanups++
      })
      return memory.host.createElement('view')
    }

    renderChild(wrapper, () => (count() > 5 ? branch : null))
    count(7)
    count(8)

    expect(builds).toBe(1)
    expect(cleanups).toBe(0)
  })

  it('tears the outgoing branch down before building the next', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const wrapper = memory.host.createFlowHost()
    const order: string[] = []
    const first = (): HostElement => {
      onCleanup(() => order.push('first cleanup'))
      return memory.host.createElement('view')
    }
    const second = (): HostElement => {
      order.push('second build')
      return memory.host.createElement('image')
    }
    const useFirst = signal(true)

    renderChild(wrapper, () => (useFirst() ? first : second))
    useFirst(false)

    expect(order).toEqual(['first cleanup', 'second build'])
  })

  it('renders nothing when the selection is null', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const wrapper = memory.host.createFlowHost()
    const present = signal(true)

    renderChild(wrapper, () => (present() ? (): HostElement => memory.host.createElement('view') : null))
    present(false)

    expect(childrenOf(wrapper)).toHaveLength(0)
  })

  it('disposes the mounted branch when torn down', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const wrapper = memory.host.createFlowHost()
    let cleaned = false
    const branch = (): HostElement => {
      onCleanup(() => {
        cleaned = true
      })
      return memory.host.createElement('view')
    }

    const dispose = renderChild(wrapper, () => branch)
    expect(cleaned).toBe(false)
    dispose()
    expect(cleaned).toBe(true)
  })
})

/**
 * The in-memory children behind an opaque wrapper handle.
 *
 * `renderChild` takes a `HostElement`, which is opaque by design, so a test that
 * wants to see what landed inside has to look behind the brand. That is the
 * memory host's own node type on the other side of the cast.
 */
const childrenOf = (wrapper: HostElement): readonly { kind: string }[] =>
  (wrapper as unknown as { children: { kind: string }[] }).children

/** The tag of the wrapper's single child, failing loudly if there is not exactly one. */
const tagOfOnlyChild = (wrapper: HostElement): string => {
  const children = childrenOf(wrapper)
  const only = children[0]
  if (children.length !== 1 || only === undefined) {
    throw new Error(`expected exactly one child, found ${children.length}`)
  }
  return (only as unknown as { tag: string }).tag
}
