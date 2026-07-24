// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { createHost } from './create-host'

describe('create-host', () => {
  it('creates a layout-neutral display:contents div', () => {
    const host = createHost()
    expect(host.tagName).toBe('DIV')
    // display:contents keeps the wrapper out of the layout box model so its
    // children participate in the parent's flow directly.
    expect(host.style.display).toBe('contents')
  })

  it('returns a fresh element each call', () => {
    expect(createHost()).not.toBe(createHost())
  })
})
