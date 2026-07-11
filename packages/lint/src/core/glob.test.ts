import { describe, expect, it } from 'vitest'

import { globToRegExp, matchesGlob } from './glob'

describe('glob', () => {
  it('matches a single segment with *', () => {
    expect(matchesGlob('api.yaml', ['*.yaml'])).toBe(true)
    expect(matchesGlob('api.json', ['*.yaml'])).toBe(false)
    // A slashless pattern also matches by basename, so a nested file still hits.
    expect(matchesGlob('src/api.yaml', ['*.yaml'])).toBe(true)
    // But a slash-bearing single-* pattern does not cross a separator.
    expect(matchesGlob('src/api.yaml', ['x/*.yaml'])).toBe(false)
  })

  it('matches any number of segments with **', () => {
    expect(matchesGlob('src/nested/api.yaml', ['src/**/*.yaml'])).toBe(true)
    expect(matchesGlob('src/api.yaml', ['src/**/*.yaml'])).toBe(true)
    expect(matchesGlob('legacy/api.yaml', ['src/**'])).toBe(false)
  })

  it('matches a single character with ?', () => {
    expect(matchesGlob('a.yaml', ['?.yaml'])).toBe(true)
    expect(matchesGlob('ab.yaml', ['?.yaml'])).toBe(false)
  })

  it('expands brace alternations', () => {
    expect(matchesGlob('api.yaml', ['*.{yaml,yml,json}'])).toBe(true)
    expect(matchesGlob('api.yml', ['*.{yaml,yml,json}'])).toBe(true)
    expect(matchesGlob('api.json', ['*.{yaml,yml,json}'])).toBe(true)
    expect(matchesGlob('api.toml', ['*.{yaml,yml,json}'])).toBe(false)
  })

  it('expands multiple brace groups cartesian', () => {
    const pattern = ['{src,lib}/*.{ts,js}']
    expect(matchesGlob('src/index.ts', pattern)).toBe(true)
    expect(matchesGlob('lib/index.js', pattern)).toBe(true)
    expect(matchesGlob('test/index.ts', pattern)).toBe(false)
  })

  it('matches a bare (slashless) pattern against the basename', () => {
    expect(matchesGlob('deep/nested/api.yaml', ['*.yaml'])).toBe(true)
  })

  it('matches a relative pattern with a slash against an absolute path by suffix', () => {
    // Minimatch/Spectral behavior: `src/api.yaml` matches an absolute source.
    expect(matchesGlob('/home/user/repo/src/api.yaml', ['src/api.yaml'])).toBe(true)
    expect(matchesGlob('/home/user/repo/src/api.yaml', ['src/**/*.yaml'])).toBe(true)
    // A different subtree must not match.
    expect(matchesGlob('/home/user/repo/lib/api.yaml', ['src/api.yaml'])).toBe(false)
  })

  it('caches the compiled RegExp by pattern string', () => {
    expect(globToRegExp('src/**/*.yaml')).toBe(globToRegExp('src/**/*.yaml'))
  })
})
