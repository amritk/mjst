import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryHost } from '../hosts/create-memory-host'
import { clearHost, setHost, signal } from '../index'
import type { HostElement } from '../types'
import { Match } from './match'
import { MATCH, type MatchData } from './match-marker'

/** Reads the data a carrier is tagged with, which is all a `Switch` ever wants from it. */
const dataOf = (carrier: HostElement): MatchData => {
  const data = (carrier as unknown as { [MATCH]?: MatchData })[MATCH]
  if (!data) throw new Error('expected the carrier to be tagged with match data')
  return data
}

afterEach(() => {
  clearHost()
})

describe('match', () => {
  it('builds its carrier without touching the host', () => {
    // No host is installed here on purpose. Anything that asked the host for an
    // element would throw, so passing proves the carrier is a plain object and
    // that a Switch of ten branches allocates no views for the nine that lose.
    const carrier = Match({ when: true, children: () => ({}) as HostElement })
    expect(dataOf(carrier)).toBeDefined()
  })

  it('normalises a plain-value condition into a getter', () => {
    const carrier = Match({ when: 'ready', children: () => ({}) as HostElement })
    expect(dataOf(carrier).when()).toBe('ready')
  })

  it('tracks a reactive condition through the getter', () => {
    const open = signal(false)
    const carrier = Match({ when: open, children: () => ({}) as HostElement })
    const when = dataOf(carrier).when
    expect(when()).toBe(false)
    open(true)
    expect(when()).toBe(true)
  })

  it('reuses an already-built element across renders', () => {
    // The element form is the state-preserving one: the same node comes back
    // every time the branch is re-entered rather than being rebuilt.
    const memory = createMemoryHost()
    setHost(memory.host)
    const node = <view />

    const carrier = Match({ when: true, children: node })
    const render = dataOf(carrier).render

    expect(render()).toBe(node)
    expect(render()).toBe(node)
  })

  it('does not build its content until the branch is selected', () => {
    let builds = 0
    const carrier = Match({
      when: true,
      children: () => {
        builds += 1
        return {} as HostElement
      },
    })

    expect(builds).toBe(0)
    dataOf(carrier).render()
    expect(builds).toBe(1)
  })
})
