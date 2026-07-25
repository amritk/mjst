import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryHost, type MemoryElement } from '../hosts/create-memory-host'
import { serializeMemoryTree } from '../hosts/serialize-memory-tree'
import { clearHost, mount, onCleanup, setHost, signal } from '../index'
import { Match } from './match'
import { Switch } from './switch'

afterEach(() => {
  clearHost()
})

describe('switch', () => {
  it('renders the first branch whose condition is truthy', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const status = signal<'loading' | 'error' | 'ready'>('ready')

    mount(memory.rootElement, () => (
      <Switch>
        <Match when={() => status() === 'loading'}>{() => <text>spinner</text>}</Match>
        <Match when={() => status() === 'error'}>{() => <text>oops</text>}</Match>
        <Match when={() => status() === 'ready'}>{() => <text>done</text>}</Match>
      </Switch>
    ))

    expect(serializeMemoryTree(memory.root)).toContain('"done"')
    status('loading')
    expect(serializeMemoryTree(memory.root)).toContain('"spinner"')
    status('error')
    expect(serializeMemoryTree(memory.root)).toContain('"oops"')
  })

  it('honours branch order when several conditions are truthy', () => {
    // Order is the whole priority rule, so two truthy branches must resolve to
    // the one written first rather than to whichever happens to be checked last.
    const memory = createMemoryHost()
    setHost(memory.host)

    mount(memory.rootElement, () => (
      <Switch>
        <Match when={true}>{() => <text>first</text>}</Match>
        <Match when={true}>{() => <text>second</text>}</Match>
      </Switch>
    ))

    const tree = serializeMemoryTree(memory.root)
    expect(tree).toContain('"first"')
    expect(tree).not.toContain('"second"')
  })

  it('falls through to the fallback when no branch matches', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const ready = signal(false)

    mount(memory.rootElement, () => (
      <Switch fallback={() => <text>nothing matched</text>}>
        <Match when={ready}>{() => <text>ready</text>}</Match>
      </Switch>
    ))

    expect(serializeMemoryTree(memory.root)).toContain('"nothing matched"')
    ready(true)
    const tree = serializeMemoryTree(memory.root)
    expect(tree).toContain('"ready"')
    expect(tree).not.toContain('"nothing matched"')
  })

  it('renders nothing when no branch matches and there is no fallback', () => {
    const memory = createMemoryHost()
    setHost(memory.host)

    mount(memory.rootElement, () => (
      <Switch>
        <Match when={false}>{() => <text>never</text>}</Match>
      </Switch>
    ))

    // The wrapper element still exists; it is simply empty.
    const wrapper = memory.root.children[0] as MemoryElement
    expect(wrapper.children).toHaveLength(0)
  })

  it('never builds the losing branches', () => {
    // This is the point of Switch over a stack of Shows: the branches are often
    // whole screens, and building the ones nobody is looking at would mean real
    // view trees crossing the bridge for nothing.
    const memory = createMemoryHost()
    setHost(memory.host)
    const status = signal<'loading' | 'ready'>('loading')
    let loadingBuilds = 0
    let readyBuilds = 0

    mount(memory.rootElement, () => (
      <Switch fallback={() => <text>idle</text>}>
        <Match when={() => status() === 'loading'}>
          {() => {
            loadingBuilds += 1
            return <text>spinner</text>
          }}
        </Match>
        <Match when={() => status() === 'ready'}>
          {() => {
            readyBuilds += 1
            return <text>done</text>
          }}
        </Match>
      </Switch>
    ))

    expect(loadingBuilds).toBe(1)
    expect(readyBuilds).toBe(0)

    status('ready')
    expect(loadingBuilds).toBe(1)
    expect(readyBuilds).toBe(1)
  })

  it('tears the losing branch down so it stops reacting', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const status = signal<'loading' | 'ready'>('loading')
    let cleaned = false

    mount(memory.rootElement, () => (
      <Switch>
        <Match when={() => status() === 'loading'}>
          {() => {
            onCleanup(() => {
              cleaned = true
            })
            return <text>spinner</text>
          }}
        </Match>
        <Match when={() => status() === 'ready'}>{() => <text>done</text>}</Match>
      </Switch>
    ))

    expect(cleaned).toBe(false)
    status('ready')
    expect(cleaned).toBe(true)
  })

  it('skips children that are not Match branches', () => {
    // JSX hands whitespace and conditional nulls through as children, and a
    // Switch that choked on them would be unusable in real markup.
    const memory = createMemoryHost()
    setHost(memory.host)

    mount(memory.rootElement, () => (
      <Switch>
        {null} <Match when={true}>{() => <text>real</text>}</Match>
      </Switch>
    ))

    expect(serializeMemoryTree(memory.root)).toContain('"real"')
  })
})
