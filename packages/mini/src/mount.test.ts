// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { bindText } from './bind'
import { mount } from './mount'
import { onCleanup } from './on-cleanup'
import { signal } from './signals'

describe('mount', () => {
  it('appends the component and returns a working dispose', () => {
    const container = document.createElement('div')
    const dispose = mount(container, () => {
      const el = document.createElement('p')
      el.textContent = 'hi'
      return el
    })
    expect(container.textContent).toBe('hi')
    dispose()
    expect(container.children).toHaveLength(0)
  })

  it('owns the root scope so bindings stop and onCleanup runs on dispose', () => {
    const container = document.createElement('div')
    const label = signal('live')
    const torn: string[] = []
    const dispose = mount(container, () => {
      const el = document.createElement('span')
      bindText(el, label)
      // A top-level onCleanup only fires because `mount` opened an effectScope
      // to own it — appended raw, this callback would never run.
      onCleanup(() => torn.push('cleanup'))
      return el
    })
    const node = container.firstElementChild as HTMLElement
    expect(node.textContent).toBe('live')

    dispose()
    expect(torn).toEqual(['cleanup'])
    // The binding died with the scope, so later writes no longer touch the node.
    label('after-dispose')
    expect(node.textContent).toBe('live')
  })
})
