import { describe, expect, it } from 'vitest'

import { defaultRoutesImport } from './default-routes-import'

describe('default-routes-import', () => {
  it('prefixes ./ for a sibling module', () => {
    expect(defaultRoutesImport('/app/dist/handler.js', '/app/dist/routes.ts')).toBe('./routes.ts')
  })

  it('climbs out of the out directory with ../ segments', () => {
    expect(defaultRoutesImport('/app/dist/nested/handler.js', '/app/src/routes.ts')).toBe('../../src/routes.ts')
  })

  it('keeps the module extension as written on disk', () => {
    expect(defaultRoutesImport('/app/handler.js', '/app/routes.mjs')).toBe('./routes.mjs')
  })
})
