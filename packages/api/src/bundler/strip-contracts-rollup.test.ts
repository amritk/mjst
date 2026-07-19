import { describe, expect, it } from 'vitest'

import { stripContractsRollup } from './strip-contracts-rollup'

const contractModule = `export const c = defineContract({
  method: 'get',
  path: '/status',
  summary: 'freight',
  responses: { 200: { body: { type: 'object' } } },
})`

describe('strip-contracts-rollup', () => {
  it('strips defineContract call sites and returns a null map', () => {
    const plugin = stripContractsRollup()
    const result = plugin.transform(contractModule, '/app/src/contracts.ts')
    expect(result?.code).not.toContain('summary')
    expect(result?.code).toContain('body: true')
    expect(result?.map).toBeNull()
  })

  it('skips non-script ids and modules without defineContract', () => {
    const plugin = stripContractsRollup()
    expect(plugin.transform(contractModule, '/app/src/contracts.css')).toBeNull()
    expect(plugin.transform('export const x = 1', '/app/src/x.ts')).toBeNull()
  })

  it('returns null when the transform is a no-op', () => {
    // Mentions defineContract but has no parseable call site — Rollup must
    // keep the original module (and its sourcemap) untouched.
    const plugin = stripContractsRollup()
    expect(plugin.transform(`export { defineContract } from '@amritk/api'`, '/app/src/reexport.ts')).toBeNull()
  })

  it('leaves excluded modules untouched — for apps that read schemas at runtime', () => {
    const plugin = stripContractsRollup({ exclude: /form-contracts/ })
    expect(plugin.transform(contractModule, '/app/src/form-contracts.ts')).toBeNull()
    expect(plugin.transform(contractModule, '/app/src/contracts.ts')?.code).toContain('body: true')
  })

  it('preserves line numbers for code after a stripped call site', () => {
    const source = `${contractModule}\nexport const sentinelAfter = 1`
    const plugin = stripContractsRollup()
    const result = plugin.transform(source, '/app/src/contracts.ts')
    const lines = result?.code.split('\n') ?? []
    expect(lines.length).toBe(source.split('\n').length)
    expect(lines.indexOf('export const sentinelAfter = 1')).toBe(source.split('\n').indexOf('export const sentinelAfter = 1'))
  })
})
