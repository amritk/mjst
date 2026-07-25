import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Host } from './host'
import { createMemoryHost, type MemoryElement } from './hosts/create-memory-host'
import { clearHost, list, onCleanup, setHost, signal } from './index'
import type { HostElement } from './types'

type Row = { id: string; label: string }

/**
 * Wraps a host so a test can count the tree surgery the reconciler performs.
 *
 * Asserting on the ORDER a list ends up in only proves it converged; it says
 * nothing about how much work that cost. On a native target the cost is the
 * interesting half — every insert and remove is a call across the bridge — so
 * the move-minimal guarantee has to be measured, not assumed.
 */
const counting = (
  host: Host,
): { host: Host; inserts: () => number; removes: () => number; clears: () => number; reset: () => void } => {
  let inserts = 0
  let removes = 0
  let clears = 0
  return {
    inserts: () => inserts,
    removes: () => removes,
    clears: () => clears,
    reset: () => {
      inserts = 0
      removes = 0
      clears = 0
    },
    host: {
      ...host,
      insert: (parent, node, anchor) => {
        inserts++
        host.insert(parent, node, anchor)
      },
      remove: (node) => {
        removes++
        host.remove(node)
      },
      clear: (element) => {
        clears++
        host.clear(element)
      },
    },
  }
}

/** Renders a keyed list into a fresh container and hands back the container to inspect. */
const renderList = (
  rows: () => readonly Row[],
  create: (row: Row) => HostElement = (row) => <text>{row.label}</text>,
): MemoryElement => {
  const memory = createMemoryHost()
  setHost(memory.host)
  const container = memory.host.createElement('view')
  memory.host.insert(memory.rootElement, container, null)
  list(container, rows, (row) => row.id, create)
  return container as unknown as MemoryElement
}

/** Reads the nth child as an element, failing loudly if it is missing. */
const childAt = (element: MemoryElement, index: number): MemoryElement => {
  const child = element.children[index]
  if (child === undefined || child.kind !== 'element') {
    throw new Error(`expected an element child at index ${index}`)
  }
  return child
}

/** The label text of each row, which is what every ordering assertion cares about. */
const labels = (container: MemoryElement): string[] =>
  container.children.map((child) => {
    const text = (child as MemoryElement).children[0]
    return text && text.kind === 'text' ? text.value : ''
  })

/**
 * The console, reached through `globalThis` rather than as an ambient global.
 *
 * This package type-checks without any platform library — that absence is what
 * proves the core carries no DOM dependency — and `console` is a host global
 * rather than part of ECMAScript, so it has to be named explicitly here just as
 * `warn.ts` does in the source.
 */
const consoleLike = (globalThis as unknown as { console: { warn: (...data: readonly unknown[]) => void } }).console

afterEach(() => {
  clearHost()
})

describe('list', () => {
  it('renders a row per item in order', () => {
    const rows = signal<Row[]>([
      { id: 'a', label: 'alpha' },
      { id: 'b', label: 'beta' },
    ])

    expect(labels(renderList(rows))).toEqual(['alpha', 'beta'])
  })

  it('appends without rebuilding the rows already present', () => {
    const rows = signal<Row[]>([{ id: 'a', label: 'alpha' }])
    const container = renderList(rows)
    const first = childAt(container, 0)

    rows([...rows(), { id: 'b', label: 'beta' }])

    expect(labels(container)).toEqual(['alpha', 'beta'])
    // Identity, not just content: an append must leave the existing node
    // untouched, which is the whole point of keying.
    expect(childAt(container, 0)).toBe(first)
  })

  it('reuses nodes across a reorder rather than rebuilding them', () => {
    const rows = signal<Row[]>([
      { id: 'a', label: 'alpha' },
      { id: 'b', label: 'beta' },
      { id: 'c', label: 'gamma' },
    ])
    const container = renderList(rows)
    const a = childAt(container, 0)
    const b = childAt(container, 1)
    const c = childAt(container, 2)

    rows([rows()[2] as Row, rows()[0] as Row, rows()[1] as Row])

    expect(labels(container)).toEqual(['gamma', 'alpha', 'beta'])
    expect(container.children).toEqual([c, a, b])
  })

  it('disposes a removed row so its bindings stop reacting', () => {
    const removed: string[] = []
    const rows = signal<Row[]>([
      { id: 'a', label: 'alpha' },
      { id: 'b', label: 'beta' },
    ])
    const container = renderList(rows, (row) => {
      onCleanup(() => removed.push(row.id))
      return <text>{row.label}</text>
    })

    rows([rows()[0] as Row])

    expect(labels(container)).toEqual(['alpha'])
    expect(removed).toEqual(['b'])
  })

  it('rebuilds a row when its key changes even though its position did not', () => {
    const rows = signal<Row[]>([{ id: 'a', label: 'alpha' }])
    const container = renderList(rows)
    const first = childAt(container, 0)

    rows([{ id: 'replaced', label: 'alpha' }])

    // Same slot and same label, but a new key means a new identity — otherwise
    // a row would silently keep state belonging to different data.
    expect(childAt(container, 0)).not.toBe(first)
  })

  it('keeps existing rows reactive after another row is appended', () => {
    // The regression this guards against is nasty precisely because it looks
    // fine: the rows stay on screen with the right text, but their bindings are
    // dead, so nothing they depend on ever updates them again. It happens when
    // a row's scope is owned by the reconciliation effect, since that effect
    // re-runs — and disposes everything it owns — on every collection change.
    const label = signal('before')
    const rows = signal<Row[]>([{ id: 'a', label: 'alpha' }])
    const container = renderList(rows, () => <text>{() => label()}</text>)

    rows([...rows(), { id: 'b', label: 'beta' }])
    label('after')

    expect(labels(container)[0]).toBe('after')
  })

  it('empties the container when the collection empties', () => {
    const rows = signal<Row[]>([{ id: 'a', label: 'alpha' }])
    const container = renderList(rows)

    rows([])

    expect(container.children).toHaveLength(0)
  })

  it('moves nothing when an item is removed from the middle', () => {
    // The naive cursor reconciler this replaced re-inserted every row after the
    // gap, because its cursor desynchronised and never recovered. That is a
    // bridge call per row for an edit that should be free, and it is one of the
    // most common things a user does to a list.
    const memory = createMemoryHost()
    const counter = counting(memory.host)
    setHost(counter.host)
    const container = counter.host.createElement('view')
    const rows = signal('abcdefghij'.split('').map((id) => ({ id, label: id })))
    list(
      container,
      rows,
      (row) => row.id,
      (row) => <text>{row.label}</text>,
    )

    counter.reset()
    rows(rows().filter((row) => row.id !== 'e'))

    expect(counter.inserts()).toBe(0)
    expect(counter.removes()).toBe(1)
    expect(labels(container as unknown as MemoryElement).join('')).toBe('abcdfghij')
  })

  it('moves one node when a row travels the length of the list', () => {
    const memory = createMemoryHost()
    const counter = counting(memory.host)
    setHost(counter.host)
    const container = counter.host.createElement('view')
    const rows = signal('abcdefghij'.split('').map((id) => ({ id, label: id })))
    list(
      container,
      rows,
      (row) => row.id,
      (row) => <text>{row.label}</text>,
    )

    counter.reset()
    const next = [...rows()]
    const head = next.shift() as Row
    rows([...next, head])

    // The two-ended walk catches this on its cross case: one insert, not nine.
    expect(counter.inserts()).toBe(1)
    expect(labels(container as unknown as MemoryElement).join('')).toBe('bcdefghija')
  })

  it('empties through a single host clear rather than row by row', () => {
    const memory = createMemoryHost()
    const counter = counting(memory.host)
    setHost(counter.host)
    const container = counter.host.createElement('view')
    const rows = signal(Array.from({ length: 50 }, (_, i) => ({ id: String(i), label: String(i) })))
    list(
      container,
      rows,
      (row) => row.id,
      (row) => <text>{row.label}</text>,
    )

    counter.reset()
    rows([])

    expect(counter.clears()).toBe(1)
    expect(counter.removes()).toBe(0)
  })

  it('warns and drops a row rather than silently collapsing a duplicate key', () => {
    // Two items claiming one identity used to render as one row with no
    // complaint, which reads exactly like data going missing. `indexKey` is the
    // supported way to render a collection of primitives that can repeat.
    const memory = createMemoryHost()
    setHost(memory.host)
    const warn = vi.spyOn(consoleLike, 'warn').mockImplementation(() => {})
    const container = memory.host.createElement('view')

    list(
      container,
      () => ['red', 'red', 'blue'],
      (tag) => tag,
      (tag) => <text>{tag}</text>,
    )

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate key'), 'red')
    expect(labels(container as unknown as MemoryElement)).toEqual(['red', 'blue'])
    warn.mockRestore()
  })

  it('stops tracking once disposed', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const container = memory.host.createElement('view')
    const rows = signal<Row[]>([{ id: 'a', label: 'alpha' }])
    const dispose = list(
      container,
      rows,
      (row) => row.id,
      (row) => <text>{row.label}</text>,
    )

    dispose()
    rows([...rows(), { id: 'b', label: 'beta' }])

    expect((container as unknown as MemoryElement).children).toHaveLength(1)
  })
})
