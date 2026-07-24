// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import { createRouter } from './create-router'
import { RouterView } from './view'

const div = (text: string) => (): HTMLElement => {
  const el = document.createElement('div')
  el.textContent = text
  return el
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('RouterView', () => {
  it('renders the matched route view and swaps it on navigation', () => {
    const router = createRouter({
      routes: [
        { path: '/', view: div('home') },
        { path: '/users/:id', view: div('user') },
        { path: '*', view: div('not-found') },
      ],
    })
    const host = RouterView({ router })
    expect(host.textContent).toBe('home')
    router.navigate('/users/1')
    expect(host.textContent).toBe('user')
    router.navigate('/nowhere')
    expect(host.textContent).toBe('not-found')
    router.stop()
  })

  it('renders the fallback when the matched route carries no view', () => {
    const router = createRouter({ routes: [{ path: '/' }] })
    const host = RouterView({ router, fallback: div('fallback') })
    expect(host.textContent).toBe('fallback')
    router.stop()
  })

  it('throws a clear error when the matched route stores a non-function view', () => {
    // A common misconfiguration: `view` holds a built element or a string rather
    // than a factory. Guard it with a readable message instead of crashing when
    // renderChild tries to call it.
    const router = createRouter({ routes: [{ path: '/', view: 'not-a-factory' }] })
    expect(() => RouterView({ router })).toThrow(/view factory/)
    router.stop()
  })

  it('keeps the same view across a same-route param change', () => {
    // `/users/1` → `/users/2` matches one route definition, so its view factory
    // is a stable reference and the mounted node must be preserved (params update
    // reactively inside it) rather than torn down and rebuilt.
    let builds = 0
    const user = (): HTMLElement => {
      builds += 1
      return document.createElement('div')
    }
    const router = createRouter({ routes: [{ path: '/users/:id', view: user }] })
    router.navigate('/users/1')
    const host = RouterView({ router })
    const node = host.firstChild
    expect(builds).toBe(1)
    router.navigate('/users/2')
    // Same route definition → same view factory → same node kept in place.
    expect(builds).toBe(1)
    expect(host.firstChild).toBe(node)
    router.stop()
  })
})
