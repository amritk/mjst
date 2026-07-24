// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { signal } from '../signals'
import { Link } from './link'

describe('link', () => {
  it('renders a real anchor with the href set', () => {
    const anchor = Link({ to: '/about', navigate: () => {}, children: 'About' }) as HTMLAnchorElement
    expect(anchor.tagName).toBe('A')
    expect(anchor.getAttribute('href')).toBe('/about')
    expect(anchor.textContent).toBe('About')
  })

  it('navigates on a plain left click and prevents the default load', () => {
    const calls: Array<{ to: string; replace: boolean | undefined }> = []
    const anchor = Link({
      to: '/next',
      navigate: (to, options) => calls.push({ to, replace: options?.replace }),
      children: 'Next',
    })
    const event = new MouseEvent('click', { button: 0, cancelable: true, bubbles: true })
    anchor.dispatchEvent(event)
    expect(calls).toEqual([{ to: '/next', replace: false }])
    expect(event.defaultPrevented).toBe(true)
  })

  it('passes replace through to navigate', () => {
    const calls: Array<boolean | undefined> = []
    const anchor = Link({
      to: '/x',
      replace: true,
      navigate: (_to, options) => calls.push(options?.replace),
    })
    anchor.dispatchEvent(new MouseEvent('click', { button: 0, cancelable: true }))
    expect(calls).toEqual([true])
  })

  it('ignores modified clicks so the browser can open a new tab', () => {
    let navigated = false
    const anchor = Link({ to: '/x', navigate: () => (navigated = true) })
    const event = new MouseEvent('click', { button: 0, metaKey: true, cancelable: true })
    anchor.dispatchEvent(event)
    expect(navigated).toBe(false)
    // The default is left intact so the browser handles the modified click.
    expect(event.defaultPrevented).toBe(false)
  })

  it('ignores non-primary button clicks', () => {
    let navigated = false
    const anchor = Link({ to: '/x', navigate: () => (navigated = true) })
    anchor.dispatchEvent(new MouseEvent('click', { button: 1, cancelable: true }))
    expect(navigated).toBe(false)
  })

  it('forwards a class when provided', () => {
    const anchor = Link({ to: '/x', navigate: () => {}, class: 'nav-link' })
    expect(anchor.getAttribute('class')).toBe('nav-link')
  })

  it('tracks a reactive destination for both href and navigation', () => {
    const calls: string[] = []
    const to = signal('/a')
    const anchor = Link({ to, navigate: (dest) => calls.push(dest) })
    expect(anchor.getAttribute('href')).toBe('/a')
    to('/b')
    expect(anchor.getAttribute('href')).toBe('/b')
    anchor.dispatchEvent(new MouseEvent('click', { button: 0, cancelable: true }))
    expect(calls).toEqual(['/b'])
  })

  it('toggles activeClass and aria-current from the active getter', () => {
    const here = signal(true)
    const anchor = Link({ to: '/x', navigate: () => {}, class: 'link', active: here, activeClass: 'is-active' })
    expect(anchor.getAttribute('class')).toBe('link is-active')
    expect(anchor.getAttribute('aria-current')).toBe('page')
    here(false)
    expect(anchor.getAttribute('class')).toBe('link')
    expect(anchor.getAttribute('aria-current')).toBe(null)
  })

  it('forwards common anchor attributes', () => {
    const anchor = Link({ to: '/x', navigate: () => {}, target: '_blank', rel: 'noopener', title: 'Go' })
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toBe('noopener')
    expect(anchor.getAttribute('title')).toBe('Go')
  })
})
