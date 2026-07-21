// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { signal } from '../signals'
import { For } from './for'

type Item = { id: string; label: string }

const labels = (host: HTMLElement): string[] => [...host.children].map((child) => child.textContent ?? '')

const row = (item: Item): HTMLElement => {
  const node = document.createElement('div')
  node.textContent = item.label
  return node
}

describe('for', () => {
  it('renders each item through the child factory', () => {
    const items = signal<readonly Item[]>([
      { id: '1', label: 'a' },
      { id: '2', label: 'b' },
    ])
    const host = For({ each: items, key: (item) => item.id, children: row })
    expect(labels(host)).toEqual(['a', 'b'])
  })

  it('keys by the provided function so nodes follow their data', () => {
    const items = signal<readonly Item[]>([{ id: '1', label: 'a' }])
    const host = For({ each: items, key: (item) => item.id, children: row })
    const first = host.firstElementChild
    items([
      { id: '1', label: 'a' },
      { id: '2', label: 'b' },
    ])
    // The '1' node is untouched because its key is unchanged — the same
    // append-only guarantee `list` gives.
    expect(host.firstElementChild).toBe(first)
    expect(labels(host)).toEqual(['a', 'b'])
  })

  it('removes nodes whose keys leave the collection', () => {
    const items = signal<readonly Item[]>([
      { id: '1', label: 'a' },
      { id: '2', label: 'b' },
    ])
    const host = For({ each: items, key: (item) => item.id, children: row })
    items([{ id: '2', label: 'b' }])
    expect(labels(host)).toEqual(['b'])
  })

  it('defaults the key to an object id when none is given', () => {
    const items = signal<readonly Item[]>([{ id: '7', label: 'x' }])
    const host = For({ each: items, children: row })
    const first = host.firstElementChild
    items([
      { id: '7', label: 'x' },
      { id: '8', label: 'y' },
    ])
    expect(host.firstElementChild).toBe(first)
    expect(labels(host)).toEqual(['x', 'y'])
  })

  it('passes the creation-time index to the child factory', () => {
    const items = signal<readonly Item[]>([
      { id: '1', label: 'a' },
      { id: '2', label: 'b' },
    ])
    const host = For({
      each: items,
      key: (item) => item.id,
      children: (item, index) => {
        const node = document.createElement('div')
        node.textContent = `${index}:${item.label}`
        return node
      },
    })
    expect(labels(host)).toEqual(['0:a', '1:b'])
  })
})
