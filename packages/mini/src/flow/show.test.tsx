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

  it('does not rebuild the branch when a derived condition changes without flipping', () => {
    // The regression this guards: `when` reads `count`, so the effect re-runs on
    // every `count` write, but the branch stays truthy from 6 upward. Rebuilding
    // then would drop focus/scroll and re-run bindings in an unchanged subtree.
    const count = signal(6)
    let builds = 0
    const host = Show({
      when: () => count() > 5,
      children: () => {
        builds += 1
        return document.createElement('span')
      },
    })
    const first = host.firstChild
    expect(builds).toBe(1)
    count(7)
    count(8)
    // Same node, built once — the derived condition never flipped.
    expect(builds).toBe(1)
    expect(host.firstChild).toBe(first)
    // A real flip still rebuilds.
    count(0)
    expect(host.childNodes).toHaveLength(0)
    count(9)
    expect(builds).toBe(2)
  })

  it('keeps a truthy-to-truthy value change from rebuilding a reused node', () => {
    const user = signal<{ name: string }>({ name: 'Ada' })
    const node = document.createElement('input')
    node.value = 'draft'
    Show({ when: user, children: node })
    // A different truthy user must not tear down and re-insert the node.
    user({ name: 'Grace' })
    expect(node.value).toBe('draft')
  })
})
