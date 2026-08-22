import { describe, expect, it } from 'vitest'
import { isInsideDirectory } from '#helpers/inside-directory'

describe('inside-directory', () => {
  it('accepts a file in the directory', () => {
    expect(isInsideDirectory('/out', 'index.md')).toBe(true)
    expect(isInsideDirectory('/out', 'guides/typescript.md')).toBe(true)
    expect(isInsideDirectory('/out', './guides/../index.md')).toBe(true)
  })

  // `..extra.md` is an ordinary file name, and a string-prefix test refused it.
  it('accepts a file name that merely begins with dots', () => {
    expect(isInsideDirectory('/out', '..extra.md')).toBe(true)
    expect(isInsideDirectory('/out', '...')).toBe(true)
  })

  it('refuses a path that climbs out', () => {
    expect(isInsideDirectory('/out', '..')).toBe(false)
    expect(isInsideDirectory('/out', '../x.md')).toBe(false)
    expect(isInsideDirectory('/out', '../../etc/passwd')).toBe(false)
    expect(isInsideDirectory('/out', 'a/../../x.md')).toBe(false)
    expect(isInsideDirectory('/out', './../x.md')).toBe(false)
  })

  // A path that climbs out and back in does land inside, and this guard asks
  // only where the write goes. What makes it unacceptable is that it collides
  // with another page's file, which the page model refuses before this runs.
  it('accepts a path that climbs out and returns to the same directory', () => {
    expect(isInsideDirectory('/out', '../out/a.md')).toBe(true)
  })

  it('refuses an absolute path', () => {
    expect(isInsideDirectory('/out', '/etc/passwd')).toBe(false)
  })

  it('refuses a path that names the directory itself', () => {
    expect(isInsideDirectory('/out', '')).toBe(false)
    expect(isInsideDirectory('/out', '.')).toBe(false)
    expect(isInsideDirectory('/out', 'x/..')).toBe(false)
  })
})
