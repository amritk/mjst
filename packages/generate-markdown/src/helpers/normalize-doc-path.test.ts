import { describe, expect, it } from 'vitest'
import { normalizeDocPath } from '#helpers/normalize-doc-path'

describe('normalize-doc-path', () => {
  it('leaves an ordinary path alone', () => {
    expect(normalizeDocPath('guides/typescript.md')).toBe('guides/typescript.md')
  })

  // Two spellings of one file are one file; comparing the raw strings let a
  // second page through and it overwrote the first on disk.
  it('collapses the spellings of the same file', () => {
    expect(normalizeDocPath('./a.md')).toBe('a.md')
    expect(normalizeDocPath('sub/../a.md')).toBe('a.md')
    expect(normalizeDocPath('a//b.md')).toBe('a/b.md')
    expect(normalizeDocPath('./guides/./x/../y.md')).toBe('guides/y.md')
  })

  // A path that climbs above the output directory keeps saying so, or the write
  // guard would have nothing left to refuse.
  it('keeps a climb it cannot resolve', () => {
    expect(normalizeDocPath('../outside.md')).toBe('../outside.md')
    expect(normalizeDocPath('../../outside.md')).toBe('../../outside.md')
    expect(normalizeDocPath('a/../../outside.md')).toBe('../outside.md')
  })

  it('keeps an absolute path absolute, so it is refused rather than relativised', () => {
    expect(normalizeDocPath('/etc/passwd')).toBe('/etc/passwd')
  })

  it('normalises a path that names no file at all', () => {
    expect(normalizeDocPath('.')).toBe('')
    expect(normalizeDocPath('x/..')).toBe('')
  })
})
