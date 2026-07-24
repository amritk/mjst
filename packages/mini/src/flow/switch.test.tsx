// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { signal } from '../signals'
import { Match } from './match'
import { Switch } from './switch'

describe('switch', () => {
  it('renders the first branch whose condition is truthy', () => {
    const status = signal<'loading' | 'error' | 'ready'>('ready')
    const host = Switch({
      children: [
        Match({ when: () => status() === 'loading', children: () => document.createTextNode('spinner') }),
        Match({ when: () => status() === 'error', children: () => document.createTextNode('oops') }),
        Match({ when: () => status() === 'ready', children: () => document.createTextNode('done') }),
      ],
    })
    expect(host.textContent).toBe('done')
    status('loading')
    expect(host.textContent).toBe('spinner')
    status('error')
    expect(host.textContent).toBe('oops')
  })

  it('honours branch order when several conditions are truthy', () => {
    const host = Switch({
      children: [
        Match({ when: true, children: () => document.createTextNode('first') }),
        Match({ when: true, children: () => document.createTextNode('second') }),
      ],
    })
    expect(host.textContent).toBe('first')
  })

  it('renders the fallback when no branch matches', () => {
    const host = Switch({
      children: [Match({ when: false, children: () => document.createTextNode('never') })],
      fallback: () => document.createTextNode('nothing matched'),
    })
    expect(host.textContent).toBe('nothing matched')
  })

  it('renders nothing when no branch matches and there is no fallback', () => {
    const host = Switch({
      children: Match({ when: false, children: () => document.createElement('span') }),
    })
    expect(host.childNodes).toHaveLength(0)
  })

  it('does not rebuild the winning branch when another branch condition changes', () => {
    // Switch reads every `when()`, so any of them re-runs the effect. The winner
    // must stay put unless it actually loses — rebuilding it on an unrelated
    // condition change would drop the branch's DOM state.
    const ready = signal(true)
    const other = signal(false)
    let builds = 0
    const host = Switch({
      children: [
        Match({
          when: ready,
          children: () => {
            builds += 1
            return document.createElement('span')
          },
        }),
        Match({ when: other, children: () => document.createTextNode('other') }),
      ],
    })
    const first = host.firstChild
    expect(builds).toBe(1)
    // A losing branch's condition toggling must not rebuild the winner.
    other(true)
    other(false)
    expect(builds).toBe(1)
    expect(host.firstChild).toBe(first)
  })
})
