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

  it('stops reconciling and disposes all scopes on dispose', () => {
    const items = signal<readonly Item[]>([{ id: '1', label: 'a' }])
    const container = document.createElement('div')
    const dispose = list(container, items, (item) => item.id, makeItem)
    dispose()
    items([...items(), { id: '2', label: 'b' }])
    expect(childIds(container)).toEqual(['1'])
  })
})
