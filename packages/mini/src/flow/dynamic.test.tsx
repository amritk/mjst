// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { signal } from '../signals'
import { Dynamic } from './dynamic'

describe('dynamic', () => {
  it('renders the named intrinsic tag', () => {
    const host = Dynamic({ component: 'section', children: 'hi' })
    expect(host.firstElementChild?.tagName).toBe('SECTION')
    expect(host.textContent).toBe('hi')
  })

  it('re-renders when the component changes', () => {
    const tag = signal<'h1' | 'h2'>('h1')
    const host = Dynamic({ component: tag, children: 'title' })
    expect(host.firstElementChild?.tagName).toBe('H1')
    tag('h2')
    expect(host.firstElementChild?.tagName).toBe('H2')
    expect(host.textContent).toBe('title')
  })

  it('forwards remaining props to the rendered element', () => {
    const host = Dynamic({ component: 'a', href: '/home', children: 'link' })
    const anchor = host.firstElementChild as HTMLAnchorElement
    expect(anchor.getAttribute('href')).toBe('/home')
  })

  it('renders a component function as well as a tag', () => {
    const Chip = (props: { label: string }): HTMLElement => {
      const node = document.createElement('span')
      node.className = 'chip'
      node.textContent = props.label
      return node
    }
    // A component is passed through a getter — a bare function cannot be told
    // apart from a reactive getter.
    const host = Dynamic({ component: () => Chip, label: 'tag' })
    expect(host.querySelector('.chip')?.textContent).toBe('tag')
  })

  it('throws a clear error when a getter returns a built node instead of a component', () => {
    // The common honest mistake: `() => <div/>` (returns an element) rather than
    // `() => Div` (returns the component). The types catch it; this guards the
    // `as any` escape hatch at runtime with a readable message.
    const bad = { component: () => document.createElement('div') } as unknown as Parameters<typeof Dynamic>[0]
    expect(() => Dynamic(bad)).toThrow(/tag string or a component function/)
  })

  it('throws when the resolved component is neither a string nor a function', () => {
    const bad = { component: () => 42 } as unknown as Parameters<typeof Dynamic>[0]
    expect(() => Dynamic(bad)).toThrow(/a number/)
  })

  it('does not rebuild when an unrelated signal in the getter changes', () => {
    // The getter reads `theme` but always resolves to the same tag; the element
    // must be built once, not rebuilt on every `theme` write.
    const theme = signal('light')
    let builds = 0
    const Widget = (): HTMLElement => {
      builds += 1
      return document.createElement('div')
    }
    const host = Dynamic({
      component: () => {
        theme()
        return Widget
      },
    })
    const first = host.firstElementChild
    expect(builds).toBe(1)
    theme('dark')
    expect(builds).toBe(1)
    expect(host.firstElementChild).toBe(first)
  })
})
