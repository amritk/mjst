// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { template } from './template'

describe('template', () => {
  it('clones the parsed structure on every call', () => {
    const make = template('<div class="a"><span>hi</span></div>')
    const first = make()
    const second = make()
    expect(first.root).not.toBe(second.root)
    expect(first.root.outerHTML).toBe('<div class="a"><span>hi</span></div>')
  })

  it('collects data-ref nodes, including the root itself', () => {
    const make = template('<div data-ref="root"><button data-ref="send"></button><i></i></div>')
    const { root, ref } = make()
    expect(ref['root']).toBe(root)
    expect(ref['send']?.tagName).toBe('BUTTON')
    expect(Object.keys(ref)).toHaveLength(2)
  })

  it('keeps clones independent', () => {
    const make = template('<div><p data-ref="p"></p></div>')
    const first = make()
    const second = make()
    ;(first.ref['p'] as HTMLElement).textContent = 'changed'
    expect(second.ref['p']?.textContent).toBe('')
  })
})
