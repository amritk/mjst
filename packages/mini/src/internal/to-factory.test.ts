// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { toFactory } from './to-factory'

describe('to-factory', () => {
  it('returns a function untouched — the lazy form rebuilds on each call', () => {
    const factory = () => document.createElement('span')
    const result = toFactory(factory)
    expect(result).toBe(factory)
    // Each call builds a fresh node.
    expect(result()).not.toBe(result())
  })

  it('wraps a node so every call returns the same element — the state-preserving form', () => {
    const node = document.createElement('input')
    const factory = toFactory(node)
    expect(factory()).toBe(node)
    expect(factory()).toBe(node)
  })
})
