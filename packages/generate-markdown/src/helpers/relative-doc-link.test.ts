import { describe, expect, it } from 'vitest'
import { relativeDocLink } from '#helpers/relative-doc-link'

describe('relative-doc-link', () => {
  it('links to a page in the same directory by name', () => {
    expect(relativeDocLink('configuration.md', 'reference.md')).toBe('reference.md')
  })

  it('links down into a subdirectory', () => {
    expect(relativeDocLink('configuration.md', 'configuration/typescript.md')).toBe('configuration/typescript.md')
  })

  it('links back up out of a subdirectory', () => {
    expect(relativeDocLink('configuration/typescript.md', 'configuration.md')).toBe('../configuration.md')
  })

  it('links between siblings in the same subdirectory', () => {
    expect(relativeDocLink('guides/sdks/typescript.md', 'guides/sdks/python.md')).toBe('python.md')
  })

  it('walks up and back down between branches', () => {
    expect(relativeDocLink('guides/sdks/typescript.md', 'guides/docs/configuration.md')).toBe(
      '../docs/configuration.md',
    )
  })

  it('links to itself by name', () => {
    expect(relativeDocLink('configuration.md', 'configuration.md')).toBe('configuration.md')
  })
})
