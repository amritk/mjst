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
})
