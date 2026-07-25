import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryHost, type MemoryElement } from './hosts/create-memory-host'
import { clearHost, list, onCleanup, setHost, signal } from './index'
import type { HostElement } from './types'

type Row = { id: string; label: string }

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
