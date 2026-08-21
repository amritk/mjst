import { describe, expect, it } from 'vitest'
import { heading } from '#helpers/heading'

describe('heading', () => {
  it('builds a heading at the level asked for', () => {
    expect(heading(1, 'Configuration')).toBe('# Configuration')
    expect(heading(3, 'darkMode')).toBe('### darkMode')
  })

  // A property four levels down on a `##` page would otherwise ask for
  // `#######`, which renders as literal hashes.
  it('clamps past the deepest heading markdown has', () => {
    expect(heading(7, 'deep')).toBe('###### deep')
    expect(heading(99, 'deeper')).toBe('###### deeper')
  })

  it('clamps a level below one', () => {
    expect(heading(0, 'top')).toBe('# top')
  })
})
