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
})
