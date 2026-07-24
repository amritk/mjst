// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { signal } from '../signals'
import { Match } from './match'
import { MATCH } from './match-marker'

describe('match', () => {
  it('returns an unmounted carrier tagged with its match data', () => {
    const carrier = Match({ when: true, children: () => document.createElement('span') })
    const data = (carrier as unknown as { [MATCH]?: unknown })[MATCH]
    expect(data).toBeDefined()
    // The carrier is a placeholder that is never inserted into the document.
    expect(carrier.isConnected).toBe(false)
  })

  it('normalises a plain-value condition into a getter', () => {
    const carrier = Match({ when: 'ready', children: () => document.createElement('span') })
    const data = (carrier as unknown as { [MATCH]: { when: () => unknown } })[MATCH]
    expect(typeof data.when).toBe('function')
    expect(data.when()).toBe('ready')
  })

  it('tracks a reactive condition through the getter', () => {
    const open = signal(false)
    const carrier = Match({ when: open, children: () => document.createElement('span') })
    const data = (carrier as unknown as { [MATCH]: { when: () => unknown } })[MATCH]
    expect(data.when()).toBe(false)
    open(true)
    expect(data.when()).toBe(true)
  })

  it('normalises children into a node factory', () => {
    const node = document.createElement('div')
    const carrier = Match({ when: true, children: node })
    const data = (carrier as unknown as { [MATCH]: { render: () => Node } })[MATCH]
    // A node passed directly is reused across calls (state-preserving form).
    expect(data.render()).toBe(node)
  })
})
