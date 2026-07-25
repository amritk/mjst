import { afterEach, describe, expect, it } from 'vitest'

import type { Host } from './host'
import { createMemoryHost } from './hosts/create-memory-host'
import { clearHost, mount, requireHost, setHost, signal } from './index'

afterEach(() => {
  clearHost()
})

describe('current-host', () => {
  it('throws a boot-order error when nothing is installed', () => {
    expect(() => requireHost()).toThrow(/setHost/)
  })

  it('coalesces a whole tick of mutations into a single commit', () => {
    const memory = createMemoryHost()
    let flushes = 0
    setHost({ ...memory.host, flush: () => flushes++ })
    const label = signal(0)

    mount(memory.rootElement, () => <text>{() => String(label())}</text>)
    for (let i = 0; i < 50; i++) label(i)

    return Promise.resolve()
      .then(() => Promise.resolve())
      .then(() => {
        expect(flushes).toBe(1)
      })
  })

  it('commits against the host installed when the flush runs, not when it was queued', async () => {
    // Closing over the host at schedule time strands a swap: the outgoing host
    // receives the commit and the incoming one — the only host with anything on
    // screen — never gets flushed at all. That is the hot-reload path, and the
    // path a test suite takes between cases.
    const memory = createMemoryHost()
    let outgoing = 0
    let incoming = 0

    setHost({ ...memory.host, flush: () => outgoing++ })
    mount(memory.rootElement, () => <view />)
    setHost({ ...memory.host, flush: () => incoming++ })

    await Promise.resolve()
    await Promise.resolve()

    expect(incoming).toBe(1)
    expect(outgoing).toBe(0)
  })

  it('skips the commit step for a host that applies mutations eagerly', async () => {
    const memory = createMemoryHost()
    // A host with no `flush` is the eager case (the DOM). Nothing should be
    // scheduled at all, which is what this asserts by simply not exploding.
    const eager: Host = memory.host
    setHost(eager)

    mount(memory.rootElement, () => <view />)
    await Promise.resolve()

    expect(memory.root.children).toHaveLength(1)
  })
})
