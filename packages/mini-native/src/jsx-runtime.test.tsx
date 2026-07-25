import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryHost, type MemoryElement } from './hosts/create-memory-host'
import { dispatchMemoryEvent } from './hosts/dispatch-memory-event'
import { serializeMemoryTree } from './hosts/serialize-memory-tree'
import { clearHost, setHost, signal } from './index'
import type { HostElement } from './types'

/**
 * Every case here renders through the in-memory host under Bun, where
 * `document` genuinely does not exist. That is the point: if the runtime had
 * kept any DOM dependency, these tests could not run at all.
 */
const render = (build: () => HostElement): MemoryElement => {
  const memory = createMemoryHost()
  setHost(memory.host)
  memory.host.insert(memory.rootElement, build(), null)
  return memory.root
}

afterEach(() => {
  clearHost()
})

describe('jsx-runtime', () => {
  it('builds a tree of host elements with no DOM present', () => {
    expect('document' in globalThis).toBe(false)

    const root = render(() => (
      <view class="card">
        <text>hello</text>
      </view>
    ))

    expect(serializeMemoryTree(root)).toBe(
      ['<root>', '  <view class="card">', '    <text>', '      "hello"'].join('\n'),
    )
  })

  it('treats a function child as a reactive text binding', () => {
    const count = signal(2)
    const root = render(() => <text>{() => `count ${count()}`}</text>)

    expect(serializeMemoryTree(root)).toContain('"count 2"')
    count(7)
    expect(serializeMemoryTree(root)).toContain('"count 7"')
  })

  it('tracks a function-valued prop and freezes a called signal', () => {
    const busy = signal(true)
    // Passing the signal itself binds live; calling it reads once. This pair is
    // the whole footgun of a compilerless JSX, so it is worth pinning down.
    const root = render(() => (
      <view>
        <input disabled={busy} />
        {/* mini-static-ok: asserts the footgun on purpose */}
        <input disabled={busy()} />
      </view>
    ))

    const parent = childAt(root, 0)
    const tracked = childAt(parent, 0)
    const frozen = childAt(parent, 1)
    expect(tracked.props['disabled']).toBe(true)
    expect(frozen.props['disabled']).toBe(true)

    busy(false)
    expect(tracked.props['disabled']).toBeUndefined()
    expect(frozen.props['disabled']).toBe(true)
  })

  it('resolves the array and toggle-map forms of class', () => {
    const active = signal(false)
    const root = render(() => (
      <view>
        <view class={['card', false, 'wide']} />
        <view class={() => ({ card: true, on: active() })} />
      </view>
    ))

    const parent = childAt(root, 0)
    const fromArray = childAt(parent, 0)
    const fromMap = childAt(parent, 1)
    expect(fromArray.props['class']).toBe('card wide')
    expect(fromMap.props['class']).toBe('card')

    active(true)
    expect(fromMap.props['class']).toBe('card on')
  })

  it('wires on* props as direct listeners using native gesture names', () => {
    const taps: number[] = []
    const root = render(() => <view onTap={() => taps.push(1)} />)

    const view = childAt(root, 0)
    // The prop is onTap; the host receives it lowercased and undecorated.
    dispatchMemoryEvent(view, 'tap')
    dispatchMemoryEvent(view, 'tap')
    expect(taps).toHaveLength(2)
  })

  it('toggles visibility through show without detaching the element', () => {
    const visible = signal(true)
    const root = render(() => <view show={visible} />)

    const view = childAt(root, 0)
    expect(view.visible).toBe(true)

    visible(false)
    expect(view.visible).toBe(false)
    // Hiding must keep the element in the tree — that is what separates it
    // from the control-flow components, which remove the subtree outright.
    expect(root.children).toHaveLength(1)
  })

  it('drops nullish and boolean children so && conditionals work', () => {
    const root = render(() => (
      <view>
        {false}
        {null}
        {undefined}
        <text>kept</text>
      </view>
    ))

    expect(childAt(root, 0).children).toHaveLength(1)
  })

  it('calls ref only once the element is fully built', () => {
    let childrenAtRef = -1
    render(() => (
      <view
        ref={(element) => {
          childrenAtRef = (element as unknown as MemoryElement).children.length
        }}
      >
        <text>a</text>
        <text>b</text>
      </view>
    ))

    expect(childrenAtRef).toBe(2)
  })
})

/**
 * Reads the nth child as an element, failing loudly if it is missing. Tests read
 * far better asserting on the value than on an optional chain at every step.
 */
const childAt = (element: MemoryElement, index: number): MemoryElement => {
  const child = element.children[index]
  if (child === undefined || child.kind !== 'element') {
    throw new Error(`expected an element child at index ${index}`)
  }
  return child
}
