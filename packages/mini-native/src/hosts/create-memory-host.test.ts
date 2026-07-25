import { afterEach, describe, expect, it } from 'vitest'

import { clearHost } from '../current-host'
import type { HostElement, HostNode, HostText } from '../types'
import { createMemoryHost, type MemoryElement, type MemoryNode, type MemoryText } from './create-memory-host'
import { dispatchMemoryEvent } from './dispatch-memory-event'

/**
 * The memory host is the reference implementation of the `Host` contract and it
 * is also the host every other test in this package renders through, so a hole
 * here is a hole under the whole suite: a broken `insert` would show up as a
 * dozen unrelated failures somewhere else. These cases exercise the contract
 * directly, with no runtime in between, so a defect is reported where it lives.
 */

afterEach(() => {
  clearHost()
})

describe('create-memory-host', () => {
  it('creates an element with every field already initialised', () => {
    const { host } = createMemoryHost()

    const view = asElement(host.createElement('view'))

    // No consumer should ever meet a partially built node, so the shape is
    // asserted in full rather than field by field as the tests happen to need it.
    expect(view.kind).toBe('element')
    expect(view.tag).toBe('view')
    expect(view.props).toEqual({})
    expect(view.children).toEqual([])
    expect(view.listeners.size).toBe(0)
    expect(view.style).toBeNull()
    expect(view.visible).toBe(true)
    expect(view.parent).toBeNull()
  })

  it('creates the control-flow wrapper as an ordinary element', () => {
    const { host } = createMemoryHost()

    // An object tree has no layout to escape from, so the wrapper is just a
    // container — the same choice a native host makes.
    expect(asElement(host.createFlowHost()).tag).toBe('flow')
  })

  it('creates a text node and rewrites its value in place', () => {
    const { host } = createMemoryHost()

    const text = host.createText('hello')
    host.setText(text, 'goodbye')

    expect(asText(text).value).toBe('goodbye')
  })

  it('appends when the anchor is null', () => {
    const { host, root, rootElement } = createMemoryHost()
    const first = host.createElement('view')
    const second = host.createElement('image')

    host.insert(rootElement, first, null)
    host.insert(rootElement, second, null)

    expect(root.children.map(tagOf)).toEqual(['view', 'image'])
  })

  it('inserts before the anchor when one is given', () => {
    const { host, root, rootElement } = createMemoryHost()
    const first = host.createElement('view')
    const second = host.createElement('image')
    host.insert(rootElement, first, null)

    host.insert(rootElement, second, first)

    expect(root.children.map(tagOf)).toEqual(['image', 'view'])
  })

  it('moves a node rather than duplicating it when it is inserted again', () => {
    // `insert` detaches first on purpose: the keyed list reconciler expresses
    // every move as a plain insert, so a host that appended a second copy would
    // grow the tree on every reorder.
    const { host, root, rootElement } = createMemoryHost()
    const first = host.createElement('view')
    const second = host.createElement('image')
    host.insert(rootElement, first, null)
    host.insert(rootElement, second, null)

    host.insert(rootElement, second, first)

    expect(root.children).toHaveLength(2)
    expect(root.children.map(tagOf)).toEqual(['image', 'view'])
  })

  it('detaches a node from its old parent when it moves to a new one', () => {
    const { host, rootElement } = createMemoryHost()
    const left = host.createElement('view')
    const right = host.createElement('view')
    const child = host.createElement('text')
    host.insert(rootElement, left, null)
    host.insert(rootElement, right, null)
    host.insert(left, child, null)

    host.insert(right, child, null)

    expect(asElement(left).children).toEqual([])
    expect(asElement(right).children).toHaveLength(1)
    expect(asElement(child).parent).toBe(asElement(right))
  })

  it('removes a node from its parent and forgets the link', () => {
    const { host, root, rootElement } = createMemoryHost()
    const view = host.createElement('view')
    host.insert(rootElement, view, null)

    host.remove(view)

    expect(root.children).toEqual([])
    expect(asElement(view).parent).toBeNull()
  })

  it('ignores a remove for a node that has no parent', () => {
    const { host } = createMemoryHost()
    const orphan = host.createElement('view')

    expect(() => host.remove(orphan)).not.toThrow()
    expect(asElement(orphan).parent).toBeNull()
  })

  it('clears every child and unlinks each one', () => {
    const { host, root, rootElement } = createMemoryHost()
    const first = host.createElement('view')
    const second = host.createElement('image')
    host.insert(rootElement, first, null)
    host.insert(rootElement, second, null)

    host.clear(rootElement)

    expect(root.children).toEqual([])
    // The parent link has to go as well, otherwise a later `insert` of the same
    // node would try to splice it out of a list it is no longer in.
    expect(asElement(first).parent).toBeNull()
    expect(asElement(second).parent).toBeNull()
  })

  it('walks the children with firstChild and nextSibling', () => {
    const { host, rootElement } = createMemoryHost()
    const first = host.createElement('view')
    const second = host.createElement('image')
    const third = host.createElement('text')
    for (const child of [first, second, third]) host.insert(rootElement, child, null)

    const walked: string[] = []
    let cursor: HostNode | null = host.firstChild(rootElement)
    while (cursor !== null) {
      walked.push(tagOf(asElement(cursor as HostElement)))
      cursor = host.nextSibling(cursor)
    }

    expect(walked).toEqual(['view', 'image', 'text'])
  })

  it('reports no first child for an empty element', () => {
    const { host, rootElement } = createMemoryHost()

    expect(host.firstChild(rootElement)).toBeNull()
  })

  it('reports no next sibling for a node with no parent', () => {
    // The list reconciler asks for the sibling of a node it has just detached,
    // so this has to answer rather than throw.
    const { host } = createMemoryHost()

    expect(host.nextSibling(host.createElement('view'))).toBeNull()
  })

  it('sets a property and reads the same value back', () => {
    const { host } = createMemoryHost()
    const view = host.createElement('view')

    host.setProperty(view, 'id', 'card')

    expect(host.getProperty(view, 'id')).toBe('card')
  })

  it('unsets a property on false, null, and undefined', () => {
    // These three are the contract's "unset it" sentinels, which is what lets a
    // single binding cover a boolean prop like `disabled`.
    const { host } = createMemoryHost()
    const view = host.createElement('view')

    for (const sentinel of [false, null, undefined]) {
      host.setProperty(view, 'disabled', true)
      host.setProperty(view, 'disabled', sentinel)
      expect(host.getProperty(view, 'disabled')).toBeUndefined()
      expect('disabled' in asElement(view).props).toBe(false)
    }
  })

  it('keeps falsy values that are not unset sentinels', () => {
    const { host } = createMemoryHost()
    const view = host.createElement('view')

    host.setProperty(view, 'count', 0)
    host.setProperty(view, 'label', '')

    expect(host.getProperty(view, 'count')).toBe(0)
    expect(host.getProperty(view, 'label')).toBe('')
  })

  it('replaces the style bag wholesale and clears it with null', () => {
    const { host } = createMemoryHost()
    const view = host.createElement('view')

    host.setStyle(view, { width: 10, color: 'red' })
    expect(asElement(view).style).toEqual({ width: 10, color: 'red' })

    host.setStyle(view, { width: 20 })
    expect(asElement(view).style).toEqual({ width: 20 })

    host.setStyle(view, null)
    expect(asElement(view).style).toBeNull()
  })

  it('keeps visibility independent of the style channel', () => {
    // The defect this pins used to hit every host: `setVisible` wrote into the
    // style bag and the next `setStyle` replaced that bag wholesale, so an
    // element carrying both `show` and `style` quietly un-hid itself. Storing
    // visibility on its own field is what makes the two orthogonal here.
    const { host } = createMemoryHost()
    const view = host.createElement('view')

    host.setVisible(view, false)
    host.setStyle(view, { width: 20 })

    expect(asElement(view).visible).toBe(false)
    expect(asElement(view).style).toEqual({ width: 20 })
  })

  it('leaves the style alone when visibility changes', () => {
    const { host } = createMemoryHost()
    const view = host.createElement('view')
    host.setStyle(view, { width: 20 })

    host.setVisible(view, false)
    host.setVisible(view, true)

    expect(asElement(view).style).toEqual({ width: 20 })
  })

  it('calls every handler registered for one event name', () => {
    const { host } = createMemoryHost()
    const view = host.createElement('view')
    const seen: string[] = []

    host.addEventListener(view, 'tap', () => seen.push('first'))
    host.addEventListener(view, 'tap', () => seen.push('second'))
    dispatchMemoryEvent(asElement(view), 'tap')

    expect(seen).toEqual(['first', 'second'])
  })

  it('detaches only the handler whose dispose was called', () => {
    const { host } = createMemoryHost()
    const view = host.createElement('view')
    const seen: string[] = []
    const detachFirst = host.addEventListener(view, 'tap', () => seen.push('first'))
    host.addEventListener(view, 'tap', () => seen.push('second'))

    detachFirst()
    dispatchMemoryEvent(asElement(view), 'tap')

    expect(seen).toEqual(['second'])
  })

  it('hands the event object straight through to the handler', () => {
    const { host } = createMemoryHost()
    const view = host.createElement('view')
    const received: unknown[] = []
    host.addEventListener(view, 'tap', (event) => received.push(event))

    const event = { x: 1 }
    dispatchMemoryEvent(asElement(view), 'tap', event)

    // The runtime never reads an event, so a host must not reshape one either.
    expect(received).toEqual([event])
  })

  it('throws when asked to insert something it did not create', () => {
    // Every host crosses the opaque-handle boundary with a cast, and a cast
    // believes whatever it is told. Without this guard a stray value lands in
    // the tree as an unrenderable child and the failure surfaces far away from
    // the line that caused it.
    const { host, rootElement } = createMemoryHost()

    expect(() => host.insert(rootElement, new Date() as unknown as HostNode, null)).toThrow(TypeError)
    expect(() => host.insert(rootElement, 'text' as unknown as HostNode, null)).toThrow(
      /can only insert nodes it created/,
    )
  })
})

/*
 * The runtime treats host nodes as opaque handles, so a test that wants to look
 * inside one has to cross the same boundary the host does. Confining the casts
 * to these helpers keeps every assertion above reading as plain property access.
 */
const asElement = (node: HostElement): MemoryElement => node as unknown as MemoryElement
const asText = (node: HostText): MemoryText => node as unknown as MemoryText

/** The tag of an in-memory node, which is what the ordering assertions compare. */
const tagOf = (node: MemoryNode): string => (node.kind === 'element' ? node.tag : 'text')
