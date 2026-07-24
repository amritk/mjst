// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { bindText } from './bind'
import { list } from './list'
import { signal } from './signals'

type Item = { id: string; label: string }

const makeItem = (item: Item): HTMLElement => {
  const node = document.createElement('div')
  node.textContent = item.label
  node.dataset['id'] = item.id
  return node
}

const childIds = (container: Element): string[] =>
  [...container.children].map((child) => (child as HTMLElement).dataset['id'] ?? '')

describe('list', () => {
  it('renders initial items in order', () => {
    const items = signal<readonly Item[]>([
      { id: '1', label: 'a' },
      { id: '2', label: 'b' },
    ])
    const container = document.createElement('div')
    list(container, items, (item) => item.id, makeItem)
    expect(childIds(container)).toEqual(['1', '2'])
  })

  it('appends without touching existing nodes', () => {
    const items = signal<readonly Item[]>([{ id: '1', label: 'a' }])
    const container = document.createElement('div')
    list(container, items, (item) => item.id, makeItem)
    const original = container.firstElementChild
    items([...items(), { id: '2', label: 'b' }])
    // Identity check matters: a streaming transcript appends on every reply,
    // and re-creating earlier bubbles would lose scroll and selection state.
    expect(container.firstElementChild).toBe(original)
    expect(childIds(container)).toEqual(['1', '2'])
  })

  it('removes dropped items and clears on empty', () => {
    const items = signal<readonly Item[]>([
      { id: '1', label: 'a' },
      { id: '2', label: 'b' },
    ])
    const container = document.createElement('div')
    list(container, items, (item) => item.id, makeItem)
    items([{ id: '2', label: 'b' }])
    expect(childIds(container)).toEqual(['2'])
    items([])
    expect(container.children).toHaveLength(0)
  })

  it('disposes an item scope when its node is removed', () => {
    const items = signal<readonly Item[]>([{ id: '1', label: 'a' }])
    const label = signal('live')
    const container = document.createElement('div')
    list(
      container,
      items,
      (item) => item.id,
      (item) => {
        const node = makeItem(item)
        // A binding created inside `create` runs in the item's scope and must
        // die with the node — otherwise removed bubbles keep reacting forever.
        bindText(node, label)
        return node
      },
    )
    const node = container.firstElementChild as HTMLElement
    expect(node.textContent).toBe('live')
    items([])
    label('after-removal')
    expect(node.textContent).toBe('live')
  })

  it('converges on reorder', () => {
    const items = signal<readonly Item[]>([
      { id: '1', label: 'a' },
      { id: '2', label: 'b' },
      { id: '3', label: 'c' },
    ])
    const container = document.createElement('div')
    list(container, items, (item) => item.id, makeItem)
    items([
      { id: '3', label: 'c' },
      { id: '1', label: 'a' },
      { id: '2', label: 'b' },
    ])
    expect(childIds(container)).toEqual(['3', '1', '2'])
  })

  it('preserves node identity across a reorder', () => {
    // Keying exists to keep each item's real DOM node (its focus/scroll/input
    // state) as rows move — assert the same elements survive, not just the order.
    const items = signal<readonly Item[]>([
      { id: '1', label: 'a' },
      { id: '2', label: 'b' },
    ])
    const container = document.createElement('div')
    list(container, items, (item) => item.id, makeItem)
    const [first, second] = [...container.children] as HTMLElement[]
    items([
      { id: '2', label: 'b' },
      { id: '1', label: 'a' },
    ])
    const byId = (id: string) => container.querySelector(`[data-id="${id}"]`)
    // The moved nodes are the very same elements, not rebuilt clones.
    expect(byId('1')).toBe(first)
    expect(byId('2')).toBe(second)
  })

  it('warns when two items share a key', () => {
    const warnings: unknown[] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => warnings.push(args)
    try {
      const items = signal<readonly Item[]>([
        { id: 'dup', label: 'a' },
        { id: 'dup', label: 'b' },
      ])
      const container = document.createElement('div')
      list(container, items, (item) => item.id, makeItem)
      // The colliding row collapses into one node; the warning makes that visible.
      expect(container.children).toHaveLength(1)
      expect(warnings).toHaveLength(1)
    } finally {
      console.warn = original
    }
  })

  it('passes the running position to key and create', () => {
    const items = signal<readonly Item[]>([
      { id: 'a', label: 'a' },
      { id: 'b', label: 'b' },
      { id: 'c', label: 'c' },
    ])
    const seenKey: number[] = []
    const seenCreate: number[] = []
    const container = document.createElement('div')
    list(
      container,
      items,
      (item, index) => {
        seenKey.push(index)
        return item.id
      },
      (item, index) => {
        seenCreate.push(index)
        return makeItem(item)
      },
    )
    // Every item's real position reaches both callbacks — no O(n) indexOf.
    expect(seenKey).toEqual([0, 1, 2])
    expect(seenCreate).toEqual([0, 1, 2])
  })

  it('stops reconciling and disposes all scopes on dispose', () => {
    const items = signal<readonly Item[]>([{ id: '1', label: 'a' }])
    const container = document.createElement('div')
    const dispose = list(container, items, (item) => item.id, makeItem)
    dispose()
    items([...items(), { id: '2', label: 'b' }])
    expect(childIds(container)).toEqual(['1'])
  })
})
