import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryHost, type MemoryElement } from '../hosts/create-memory-host'
import { clearHost, effectScope, setHost, signal } from '../index'
import type { HostElement } from '../types'
import { bindShow } from './bind-show'

afterEach(() => {
  clearHost()
})

describe('bind-show', () => {
  it('applies the initial visibility during setup', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const view = memory.host.createElement('view')

    bindShow(view, () => false)

    expect(asElement(view).visible).toBe(false)
  })

  it('follows the signal as it toggles', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const visible = signal(true)
    const view = memory.host.createElement('view')

    bindShow(view, visible)
    expect(asElement(view).visible).toBe(true)

    visible(false)
    expect(asElement(view).visible).toBe(false)

    visible(true)
    expect(asElement(view).visible).toBe(true)
  })

  it('leaves the element in the tree while it is hidden', () => {
    // This is the whole difference between the `show` prop and the `Show`
    // component: hiding keeps the subtree alive, so anything inside it — a
    // half-typed input, a scroll position — survives being hidden and shown.
    const memory = createMemoryHost()
    setHost(memory.host)
    const visible = signal(true)
    const view = memory.host.createElement('view')
    memory.host.insert(memory.rootElement, view, null)

    bindShow(view, visible)
    visible(false)

    expect(memory.root.children).toHaveLength(1)
  })

  it('does not disturb the element style', () => {
    // Visibility and style share a channel on the real hosts, and a host that
    // expresses one through the other used to clobber it. Nothing about a
    // visibility write may touch the style bag.
    const memory = createMemoryHost()
    setHost(memory.host)
    const visible = signal(true)
    const view = memory.host.createElement('view')
    memory.host.setStyle(view, { width: 20 })

    bindShow(view, visible)
    visible(false)

    expect(asElement(view).style).toEqual({ width: 20 })
  })

  it('stops updating once the returned dispose is called', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const visible = signal(true)
    const view = memory.host.createElement('view')

    const dispose = bindShow(view, visible)
    dispose()
    visible(false)

    expect(asElement(view).visible).toBe(true)
  })

  it('stops updating when the enclosing scope is disposed', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const visible = signal(true)
    const view = memory.host.createElement('view')

    const dispose = effectScope(() => {
      bindShow(view, visible)
    })
    dispose()
    visible(false)

    expect(asElement(view).visible).toBe(true)
  })
})

/** The in-memory element behind an opaque handle. */
const asElement = (element: HostElement): MemoryElement => element as unknown as MemoryElement
