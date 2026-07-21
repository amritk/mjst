// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { bindText } from '../bind'
import { signal } from '../signals'
import { Show } from './show'

describe('show', () => {
  it('renders children when the condition is truthy', () => {
    const on = signal(true)
    const host = Show({ when: on, children: () => document.createTextNode('shown') })
    expect(host.textContent).toBe('shown')
  })

  it('swaps to the fallback when the condition turns falsy', () => {
    const on = signal(true)
    const host = Show({
      when: on,
      children: () => document.createTextNode('shown'),
      fallback: () => document.createTextNode('hidden'),
    })
    expect(host.textContent).toBe('shown')
    on(false)
    expect(host.textContent).toBe('hidden')
    on(true)
    expect(host.textContent).toBe('shown')
  })

  it('renders nothing when falsy and no fallback is given', () => {
    const on = signal(false)
    const host = Show({ when: on, children: () => document.createElement('span') })
    expect(host.childNodes).toHaveLength(0)
  })

  it('treats any truthy value as shown, not just booleans', () => {
    const user = signal<{ name: string } | null>(null)
    const host = Show({
      when: user,
      children: () => document.createTextNode('has user'),
      fallback: () => document.createTextNode('no user'),
    })
    expect(host.textContent).toBe('no user')
    user({ name: 'Ada' })
    expect(host.textContent).toBe('has user')
  })

  it('tears down a hidden branch so its bindings stop reacting', () => {
    const on = signal(true)
    const label = signal('live')
    let runs = 0
    Show({
      when: on,
      children: () => {
        const node = document.createElement('span')
        // A binding created inside the branch must die when the branch leaves,
        // otherwise a removed subtree keeps reacting forever.
        bindText(node, () => {
          runs += 1
          return label()
        })
        return node
      },
    })
    expect(runs).toBe(1)
    on(false)
    // Writing the signal the removed branch depended on must not re-run it.
    label('after')
    expect(runs).toBe(1)
  })

  it('reuses a node passed directly, preserving its state across toggles', () => {
    const on = signal(true)
    const node = document.createElement('input')
    node.value = 'typed'
    const host = Show({ when: on, children: node })
    expect(host.firstChild).toBe(node)
    on(false)
    on(true)
    // Same element, so the value the user typed survives the round trip.
    expect(host.firstChild).toBe(node)
    expect((host.firstChild as HTMLInputElement).value).toBe('typed')
  })
})
