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

  describe('as', () => {
    it('renders a display:contents host by default', () => {
      const items = signal<readonly Item[]>([{ id: '1', label: 'a' }])
      const host = For({ each: items, key: (item) => item.id, children: row })
      expect(host.tagName).toBe('DIV')
      expect(host.style.display).toBe('contents')
    })

    it('renders into a real element of the given tag, with the rows as direct children', () => {
      const items = signal<readonly Item[]>([
        { id: '1', label: 'a' },
        { id: '2', label: 'b' },
      ])
      const host = For({
        each: items,
        key: (item) => item.id,
        as: 'ul',
        children: (item) => {
          const node = document.createElement('li')
          node.textContent = item.label
          return node
        },
      })
      // A real <ul> host — not a display:contents wrapper — so a `divide-y`
      // style `& > * ~ *` selector matches the rows as its direct children.
      expect(host.tagName).toBe('UL')
      expect(host.style.display).toBe('')
      expect([...host.children].map((child) => child.tagName)).toEqual(['LI', 'LI'])
      expect(labels(host)).toEqual(['a', 'b'])
    })

    it('forwards class and style to the as-host', () => {
      const items = signal<readonly Item[]>([{ id: '1', label: 'a' }])
      const host = For({
        each: items,
        key: (item) => item.id,
        as: 'ul',
        class: ['divide-y', 'divide-gray-200'],
        style: { marginTop: '4px' },
        children: row,
      })
      expect(host.getAttribute('class')).toBe('divide-y divide-gray-200')
      expect(host.style.marginTop).toBe('4px')
    })

    it('tracks a reactive class on the as-host', () => {
      const items = signal<readonly Item[]>([{ id: '1', label: 'a' }])
      const dense = signal(false)
      const host = For({
        each: items,
        key: (item) => item.id,
        as: 'ul',
        class: () => ({ 'divide-y': true, compact: dense() }),
        children: row,
      })
      expect(host.getAttribute('class')).toBe('divide-y')
      dense(true)
      expect(host.getAttribute('class')).toBe('divide-y compact')
    })

    it('exposes the as-host through ref', () => {
      const items = signal<readonly Item[]>([{ id: '1', label: 'a' }])
      let captured: HTMLElement | undefined
      const host = For({
        each: items,
        key: (item) => item.id,
        as: 'ul',
        ref: (element) => {
          captured = element
        },
        children: row,
      })
      expect(captured).toBe(host)
    })

    it('keeps keyed reconciliation working on a real host', () => {
      const items = signal<readonly Item[]>([{ id: '1', label: 'a' }])
      const host = For({ each: items, key: (item) => item.id, as: 'ul', children: row })
      const first = host.firstElementChild
      items([
        { id: '1', label: 'a' },
        { id: '2', label: 'b' },
      ])
      expect(host.firstElementChild).toBe(first)
      expect(labels(host)).toEqual(['a', 'b'])
    })
  })
})
