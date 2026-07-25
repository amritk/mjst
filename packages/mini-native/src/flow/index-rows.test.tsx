import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMemoryHost, type MemoryElement } from '../hosts/create-memory-host'
import { clearHost, mount, setHost, signal } from '../index'
import { For } from './for'
import { Index } from './index-rows'

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

/** The text of every row, which is what each ordering assertion cares about. */
const rows = (container: MemoryElement): string[] =>
  container.children.map((child) => {
    const text = (child as MemoryElement).children[0]
    return text && text.kind === 'text' ? text.value : ''
  })

/** The container the flow wrapper puts rows into. */
const wrapperOf = (memory: ReturnType<typeof createMemoryHost>): MemoryElement =>
  memory.root.children[0] as MemoryElement

describe('index-rows', () => {
  it('renders a row per position, repeats included', () => {
    // `For` with the default key would hand both "red" rows one key here, warn,
    // and drop one. Position identity is what makes the list renderable.
    const memory = createMemoryHost()
    setHost(memory.host)
    const tags = signal(['red', 'red', 'blue'])

    mount(memory.rootElement, () => <Index each={tags}>{(tag) => <text>{() => tag()}</text>}</Index>)

    expect(rows(wrapperOf(memory))).toEqual(['red', 'red', 'blue'])
  })

  it('updates a slot in place when a different item moves into it', () => {
    // The whole reason `Index` is a component rather than a key function. A row
    // is built once and never rebuilt, so keying by position alone would leave
    // this list showing the old values in the shifted slots.
    const memory = createMemoryHost()
    setHost(memory.host)
    const tags = signal(['red', 'blue'])

    mount(memory.rootElement, () => <Index each={tags}>{(tag) => <text>{() => tag()}</text>}</Index>)
    tags(['green', 'red', 'blue'])

    expect(rows(wrapperOf(memory))).toEqual(['green', 'red', 'blue'])
  })

  it('keeps the node in a slot whose item changed', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const tags = signal(['red', 'blue'])
    let builds = 0

    mount(memory.rootElement, () => (
      <Index each={tags}>
        {(tag) => {
          builds++
          return <text>{() => tag()}</text>
        }}
      </Index>
    ))
    const first = wrapperOf(memory).children[0]

    tags(['green', 'blue'])

    // One slot changed content and one row was neither rebuilt nor replaced.
    expect(builds).toBe(2)
    expect(wrapperOf(memory).children[0]).toBe(first)
  })

  it('drops the trailing rows when the collection shrinks', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const tags = signal(['a', 'b', 'c'])

    mount(memory.rootElement, () => <Index each={tags}>{(tag) => <text>{() => tag()}</text>}</Index>)
    tags(['a'])

    expect(rows(wrapperOf(memory))).toEqual(['a'])
  })

  it('composes when nested inside another Index', () => {
    // `Index` refreshes its slot signals from inside the getter `list` tracks,
    // which is a write during another component's reconciliation once these are
    // nested. Worth pinning that it settles rather than glitching.
    const memory = createMemoryHost()
    setHost(memory.host)
    const groups = signal([['a', 'b'], ['c']])

    mount(memory.rootElement, () => (
      <Index each={groups}>
        {(group) => (
          <view>
            <Index each={() => group()}>{(item) => <text>{() => item()}</text>}</Index>
          </view>
        )}
      </Index>
    ))

    const shape = (): string[][] =>
      wrapperOf(memory).children.map((group) => rows((group as MemoryElement).children[0] as MemoryElement))

    expect(shape()).toEqual([['a', 'b'], ['c']])
    groups([['z'], ['c', 'd']])
    expect(shape()).toEqual([['z'], ['c', 'd']])
  })

  it('renders duplicates that For would have to warn about', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const warn = vi.spyOn(consoleLike, 'warn').mockImplementation(() => {})
    const tags = signal(['red', 'red'])

    mount(memory.rootElement, () => (
      <view>
        <Index each={tags}>{(tag) => <text>{() => tag()}</text>}</Index>
        <For each={tags}>{(tag: string) => <text>{tag}</text>}</For>
      </view>
    ))

    const parent = memory.root.children[0] as MemoryElement
    expect(rows(parent.children[0] as MemoryElement)).toEqual(['red', 'red'])
    expect(rows(parent.children[1] as MemoryElement)).toEqual(['red'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
