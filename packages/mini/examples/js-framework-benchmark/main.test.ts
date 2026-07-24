// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { createBenchmarkApp } from './main'

const rowNodes = (element: HTMLElement): HTMLElement[] => [...element.querySelectorAll<HTMLElement>('tbody tr')]

const idOf = (row: HTMLElement): string => row.dataset['id'] ?? ''
const dangerCount = (element: HTMLElement): number => element.querySelectorAll('tbody tr.danger').length

describe('js-framework-benchmark (mini keyed)', () => {
  it('creates, appends, and clears rows', () => {
    const { element, store } = createBenchmarkApp()

    store.run()
    expect(rowNodes(element)).toHaveLength(1000)

    store.add()
    expect(rowNodes(element)).toHaveLength(2000)

    store.clear()
    expect(rowNodes(element)).toHaveLength(0)
    expect(store.selectedId()).toBeNull()
  })

  it('updates every tenth label without reconciling the list', () => {
    const { element, store } = createBenchmarkApp()
    store.run()
    const before = rowNodes(element)
    const labelText = (i: number) => before[i]?.querySelector('.lbl')?.textContent ?? ''
    const [firstBefore, secondBefore] = [labelText(0), labelText(1)]

    store.update()

    // The array reference never changed, so the row nodes are the exact same
    // elements — no rebuild, no reconcile.
    expect(rowNodes(element)[0]).toBe(before[0])
    // Every tenth label gained the suffix; the others are untouched.
    expect(labelText(0)).toBe(`${firstBefore} !!!`)
    expect(labelText(1)).toBe(secondBefore)
    expect(labelText(10)).toMatch(/ !!!$/)
  })

  it('selects a row by touching only two nodes (O(1))', () => {
    const { element, store } = createBenchmarkApp()
    store.run()
    const rows = rowNodes(element)

    // Click a cell in the third row — delegation routes it to a select.
    rows[2]?.querySelector<HTMLElement>('.lbl')?.click()
    expect(dangerCount(element)).toBe(1)
    expect(rows[2]?.classList.contains('danger')).toBe(true)
    expect(store.selectedId()).toBe(Number(idOf(rows[2] as HTMLElement)))

    // Selecting another row clears the first and marks the second — still one.
    rows[7]?.click()
    expect(dangerCount(element)).toBe(1)
    expect(rows[2]?.classList.contains('danger')).toBe(false)
    expect(rows[7]?.classList.contains('danger')).toBe(true)
  })

  it('swaps two rows, preserving node identity', () => {
    const { element, store } = createBenchmarkApp()
    store.run()
    const before = rowNodes(element)
    const [node1, node998] = [before[1] as HTMLElement, before[998] as HTMLElement]
    const [id1, id998] = [idOf(node1), idOf(node998)]

    store.swapRows()
    const after = rowNodes(element)

    // Order swapped, but the moved rows are the very same elements.
    expect(idOf(after[1] as HTMLElement)).toBe(id998)
    expect(idOf(after[998] as HTMLElement)).toBe(id1)
    expect(after[1]).toBe(node998)
    expect(after[998]).toBe(node1)
  })

  it('removes a row through the delegated remove control', () => {
    const { element, store } = createBenchmarkApp()
    store.run()
    const rows = rowNodes(element)
    const removedId = idOf(rows[3] as HTMLElement)

    // Click the glyph *inside* the remove anchor — the event bubbles to the one
    // tbody listener, which finds the row and deletes it. Proves delegation.
    rows[3]?.querySelector<HTMLElement>('.remove .glyphicon')?.click()

    expect(rowNodes(element)).toHaveLength(999)
    expect(element.querySelector(`tbody tr[data-id="${removedId}"]`)).toBeNull()
  })

  it('drops the selection when the selected row is removed', () => {
    const { element, store } = createBenchmarkApp()
    store.run()
    const rows = rowNodes(element)
    const id = Number(idOf(rows[4] as HTMLElement))

    store.select(id)
    expect(store.selectedId()).toBe(id)

    store.remove(id)
    expect(store.selectedId()).toBeNull()
    expect(dangerCount(element)).toBe(0)
  })
})
