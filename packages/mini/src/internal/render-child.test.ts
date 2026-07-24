// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { bindText } from '../bind'
import { signal } from '../signals'
import { type ChildFactory, renderChild } from './render-child'

describe('render-child', () => {
  it('mounts the selected factory node into the host', () => {
    const host = document.createElement('div')
    renderChild(host, () => () => document.createTextNode('hi'))
    expect(host.textContent).toBe('hi')
  })

  it('renders nothing when the selection is null', () => {
    const host = document.createElement('div')
    renderChild(host, () => null)
    expect(host.childNodes).toHaveLength(0)
  })

  it('swaps the node when the selection changes', () => {
    const which = signal<'a' | 'b'>('a')
    const a: ChildFactory = () => document.createTextNode('A')
    const b: ChildFactory = () => document.createTextNode('B')
    const host = document.createElement('div')
    renderChild(host, () => (which() === 'a' ? a : b))
    expect(host.textContent).toBe('A')
    which('b')
    expect(host.textContent).toBe('B')
  })

  it('disposes the previous branch scope when it is swapped out', () => {
    const which = signal(true)
    const label = signal('live')
    let runs = 0
    const host = document.createElement('div')
    renderChild(host, () =>
      which()
        ? () => {
            const node = document.createElement('span')
            bindText(node, () => {
              runs += 1
              return label()
            })
            return node
          }
        : null,
    )
    expect(runs).toBe(1)
    which(false)
    // The removed branch's binding must stop reacting.
    label('after')
    expect(runs).toBe(1)
  })

  it('does not rebuild when the selection is referentially unchanged', () => {
    // The identity memo: the effect re-runs on every `tick` write, but the same
    // factory keeps winning, so the node must be built exactly once and kept.
    const tick = signal(0)
    let builds = 0
    const factory: ChildFactory = () => {
      builds += 1
      return document.createElement('span')
    }
    const host = document.createElement('div')
    renderChild(host, () => {
      tick()
      return factory
    })
    const node = host.firstChild
    expect(builds).toBe(1)
    tick(1)
    tick(2)
    expect(builds).toBe(1)
    expect(host.firstChild).toBe(node)
  })

  it('keeps a branch binding alive across an unchanged selection', () => {
    // The subtle one: the branch stays the same factory, but a binding inside it
    // reads the very signal the selection depends on. The mounted binding must
    // keep updating — a naive identity gate that returns early inside the effect
    // would leave the branch scope disposed (by the engine) but not rebuilt, and
    // the binding would silently die.
    const count = signal(1)
    const factory: ChildFactory = () => {
      const node = document.createElement('span')
      bindText(node, () => String(count()))
      return node
    }
    const host = document.createElement('div')
    renderChild(host, () => (count() > 0 ? factory : null))
    const node = host.firstChild
    expect(host.textContent).toBe('1')
    count(2)
    // Same branch (same node, never rebuilt), but the binding inside it must
    // reflect the new value.
    expect(host.textContent).toBe('2')
    expect(host.firstChild).toBe(node)
  })

  it('stops reacting and tears down the branch on dispose', () => {
    const tick = signal(0)
    let builds = 0
    const host = document.createElement('div')
    const dispose = renderChild(host, () => {
      tick()
      builds += 1
      return () => document.createElement('span')
    })
    expect(builds).toBe(1)
    dispose()
    tick(1)
    // The tracking effect is stopped, so a dependency change no longer re-runs.
    expect(builds).toBe(1)
  })
})
