import { describe, expect, it } from 'vitest'

import * as eager from './yaml'
import * as lazy from './yaml-lazy'

// `require()` of the parser needs its built dist, which the source tests run
// without; scripts/lint-startup.test.ts covers that path against the build.
describe('yaml-lazy', () => {
  it('exports what the eager module exports', () => {
    expect(Object.keys(lazy).sort()).toEqual(Object.keys(eager).sort())
  })

  it('parses and walks YAML once preloaded', async () => {
    await lazy.preloadYaml()
    const document = lazy.parseDocument('a: &x 1\nb: *x\n')
    const contents = lazy.parseAllDocuments('k: v\n')[0]?.contents
    const pair = lazy.isMap(contents) ? contents.items[0] : undefined

    expect(lazy.isMap(document.contents)).toBe(true)
    expect(lazy.isSeq(document.contents)).toBe(false)
    expect(lazy.isAlias(lazy.isMap(document.contents) ? document.contents.items[1]?.value : undefined)).toBe(true)
    expect(lazy.isPair(pair)).toBe(true)
    expect(pair && lazy.isScalar(pair.key) && lazy.keyText(pair.key)).toBe('k')
  })
})
