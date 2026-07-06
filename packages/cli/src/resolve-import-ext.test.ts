import { describe, expect, it } from 'vitest'

import { resolveImportExt } from './resolve-import-ext'

describe('resolve-import-ext', () => {
  it("defaults to 'ts' so generated sources run under Node type stripping", () => {
    expect(resolveImportExt({})).toBe('ts')
  })

  it("falls back to 'js' under build, which compiles via tsc", () => {
    expect(resolveImportExt({ build: true })).toBe('js')
  })

  it('an explicit importExt always wins', () => {
    expect(resolveImportExt({ importExt: 'js' })).toBe('js')
    expect(resolveImportExt({ importExt: 'ts' })).toBe('ts')
    // build + explicit 'ts' is rejected upstream in the CLI; resolution itself
    // never overrides an explicit choice.
    expect(resolveImportExt({ build: true, importExt: 'ts' })).toBe('ts')
  })
})
