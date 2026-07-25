import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryHost } from './hosts/create-memory-host'
import { serializeMemoryTree } from './hosts/serialize-memory-tree'
import { clearHost, mount, onCleanup, setHost, signal } from './index'

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
})
