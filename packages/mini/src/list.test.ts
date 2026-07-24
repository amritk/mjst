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

  it('converges through arbitrary permutations, reusing nodes', () => {
    // Exercises the map-fallback branch of the two-ended diff — permutations
    // where no head or tail lines up — and asserts both the final order and that
    // every node is the original element, never rebuilt, across each step.
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: String(i), label: String(i) }))
    const items = signal<readonly Item[]>(rows)
    const container = document.createElement('div')
    list(container, items, (item) => item.id, makeItem)
    const original = new Map(([...container.children] as HTMLElement[]).map((n) => [n.dataset['id'], n]))

    for (const order of [
      ['2', '0', '3', '1', '4'],
      ['4', '3', '2', '1', '0'],
      ['1', '3', '0', '4', '2'],
    ]) {
      items(order.map((id) => ({ id, label: id })))
      expect(childIds(container)).toEqual(order)
      for (const [id, node] of original) expect(container.querySelector(`[data-id="${id}"]`)).toBe(node)
    }
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

  it('swaps two rows with two moves and no rebuilds', () => {
    // The js-framework-benchmark "swap rows" case: exchange two non-adjacent
    // rows in a long list. A move-minimal keyed diff does exactly two
    // insertBefore calls and leaves every other node — and both swapped nodes —
    // as the same elements. The old append-order walk moved O(n) nodes here.
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: String(i), label: String(i) }))
    const items = signal<readonly Item[]>(rows)
    const container = document.createElement('div')
    list(container, items, (item) => item.id, makeItem)
    const before = [...container.children] as HTMLElement[]

    const spy = container.insertBefore.bind(container)
    let moves = 0
    container.insertBefore = ((node: Node, ref: Node | null) => {
      moves++
      return spy(node, ref)
    }) as typeof container.insertBefore

    const swapped = rows.slice()
    ;[swapped[1], swapped[4]] = [swapped[4] as Item, swapped[1] as Item]
    items(swapped)

    expect(moves).toBe(2)
    expect(childIds(container)).toEqual(['0', '4', '2', '3', '1', '5'])
    // Identity: the swapped rows are the very same elements, just repositioned;
    // the untouched rows never moved.
    const byId = (id: string) => container.querySelector(`[data-id="${id}"]`)
    expect(byId('1')).toBe(before[1])
    expect(byId('4')).toBe(before[4])
    expect(byId('2')).toBe(before[2])
  })

  it('removes a middle row without moving its siblings', () => {
    // The "remove row" case: dropping an interior row must touch no other node —
    // zero insertBefore calls, one disposed node.
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: String(i), label: String(i) }))
    const items = signal<readonly Item[]>(rows)
    const container = document.createElement('div')
    list(container, items, (item) => item.id, makeItem)
    const before = [...container.children] as HTMLElement[]

    const spy = container.insertBefore.bind(container)
    let moves = 0
    container.insertBefore = ((node: Node, ref: Node | null) => {
      moves++
      return spy(node, ref)
    }) as typeof container.insertBefore

    items(rows.filter((_, i) => i !== 2))

    expect(moves).toBe(0)
    expect(childIds(container)).toEqual(['0', '1', '3', '4', '5'])
    const byId = (id: string) => container.querySelector(`[data-id="${id}"]`)
    expect(byId('1')).toBe(before[1])
    expect(byId('3')).toBe(before[3])
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
