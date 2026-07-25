import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryHost } from './hosts/create-memory-host'
import { serializeMemoryTree } from './hosts/serialize-memory-tree'
import { clearHost, list, mount, onCleanup, setHost, signal } from './index'

afterEach(() => {
  clearHost()
})

describe('mount', () => {
  it('attaches the component tree to the container', () => {
    const memory = createMemoryHost()
    setHost(memory.host)

    mount(memory.rootElement, () => <text>hello</text>)

    expect(serializeMemoryTree(memory.root)).toBe(['<root>', '  <text>', '    "hello"'].join('\n'))
  })

  it('detaches the tree when disposed', () => {
    const memory = createMemoryHost()
    setHost(memory.host)

    const dispose = mount(memory.rootElement, () => <text>hello</text>)
    dispose()

    expect(memory.root.children).toHaveLength(0)
  })

  it('runs a top-level onCleanup on dispose', () => {
    // Without `mount` opening a scope there is no owner at the root, so a
    // top-level cleanup would have nothing to attach to and would never fire.
    const memory = createMemoryHost()
    setHost(memory.host)
    let cleaned = false

    const dispose = mount(memory.rootElement, () => {
      onCleanup(() => {
        cleaned = true
      })
      return <view />
    })

    expect(cleaned).toBe(false)
    dispose()
    expect(cleaned).toBe(true)
  })

  it('stops the tree reacting once disposed', () => {
    const memory = createMemoryHost()
    setHost(memory.host)
    const label = signal('before')
    let renders = 0

    const dispose = mount(memory.rootElement, () => (
      <text>
        {() => {
          renders++
          return label()
        }}
      </text>
    ))

    const afterMount = renders
    dispose()
    label('after')

    expect(renders).toBe(afterMount)
  })

  it('disposes the rows a mounted component built', () => {
    // `list` ties its row scopes to the scope it was called in rather than to
    // the reconciliation effect, so unmounting the component has to take the
    // rows with it. If it did not, every removed row's bindings would keep
    // running against nodes nobody can see — the failure mode that looks like
    // nothing at all until something reads a signal it should not.
    const memory = createMemoryHost()
    setHost(memory.host)
    const removed: string[] = []
    const rows = signal([{ id: 'a' }, { id: 'b' }])

    const dispose = mount(memory.rootElement, () => {
      const container = memory.host.createElement('view')
      list(
        container,
        rows,
        (row) => row.id,
        (row) => {
          onCleanup(() => removed.push(row.id))
          return <text>{row.id}</text>
        },
      )
      return container
    })

    expect(removed).toEqual([])
    dispose()

    expect(removed).toEqual(['a', 'b'])
  })
})
