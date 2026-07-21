// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import { createRouter, type Route } from './create-router'

const routes: Route[] = [
  { path: '/', name: 'home' },
  { path: '/users/:id', name: 'user' },
  { path: '*', name: 'not-found' },
]

// Each test starts from a clean root URL so history/hash state never leaks.
beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('create-router', () => {
  it('matches the initial location in history mode', () => {
    window.history.replaceState(null, '', '/users/42')
    const router = createRouter({ routes })
    expect(router.route().route?.['name']).toBe('user')
    expect(router.route().params).toEqual({ id: '42' })
    router.stop()
  })

  it('updates the route signal on navigate', () => {
    const router = createRouter({ routes })
    expect(router.route().route?.['name']).toBe('home')
    router.navigate('/users/7')
    expect(router.route().route?.['name']).toBe('user')
    expect(router.route().params).toEqual({ id: '7' })
    expect(window.location.pathname).toBe('/users/7')
    router.stop()
  })

  it('pushes history by default and replaces when asked', () => {
    const router = createRouter({ routes })
    const startLength = window.history.length
    router.navigate('/users/1')
    expect(window.history.length).toBe(startLength + 1)
    router.navigate('/users/2', { replace: true })
    // A replace does not grow the history stack.
    expect(window.history.length).toBe(startLength + 1)
    expect(router.route().params).toEqual({ id: '2' })
    router.stop()
  })

  it('reacts to back/forward via popstate', () => {
    const router = createRouter({ routes })
    router.navigate('/users/9')
    expect(router.route().params).toEqual({ id: '9' })
    window.history.replaceState(null, '', '/')
    window.dispatchEvent(new Event('popstate'))
    expect(router.route().route?.['name']).toBe('home')
    router.stop()
  })

  it('falls back to the wildcard route for unknown paths', () => {
    window.history.replaceState(null, '', '/nope/here')
    const router = createRouter({ routes })
    expect(router.route().route?.['name']).toBe('not-found')
    expect(router.route().params).toEqual({ rest: 'nope/here' })
    router.stop()
  })

  it('strips the configured base before matching', () => {
    window.history.replaceState(null, '', '/app/users/5')
    const router = createRouter({ routes, base: '/app' })
    expect(router.route().params).toEqual({ id: '5' })
    router.navigate('/users/6')
    expect(window.location.pathname).toBe('/app/users/6')
    expect(router.route().params).toEqual({ id: '6' })
    router.stop()
  })

  it('reads and updates the hash in hash mode', () => {
    window.history.replaceState(null, '', '/')
    window.location.hash = '#/users/3'
    const router = createRouter({ routes, mode: 'hash' })
    expect(router.route().params).toEqual({ id: '3' })
    router.navigate('/users/4')
    window.dispatchEvent(new Event('hashchange'))
    expect(router.route().params).toEqual({ id: '4' })
    router.stop()
  })

  it('parses the query string into a reactive record', () => {
    window.history.replaceState(null, '', '/users/42?tab=posts&page=2')
    const router = createRouter({ routes })
    expect(router.route().query).toEqual({ tab: 'posts', page: '2' })
    expect(router.route().search).toBe('?tab=posts&page=2')
    router.navigate('/users/42?tab=likes')
    expect(router.route().query).toEqual({ tab: 'likes' })
    router.stop()
  })

  it('stops updating after stop is called', () => {
    const router = createRouter({ routes })
    router.stop()
    window.history.replaceState(null, '', '/users/1')
    window.dispatchEvent(new Event('popstate'))
    // The listener is detached, so the signal holds its last value.
    expect(router.route().route?.['name']).toBe('home')
  })
})
