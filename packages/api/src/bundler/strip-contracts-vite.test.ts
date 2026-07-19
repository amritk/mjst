import { describe, expect, it } from 'vitest'

import { stripContractsVite } from './strip-contracts-vite'

const contractModule = `export const c = defineContract({
  method: 'get',
  path: '/status',
  summary: 'freight',
  responses: { 200: { body: { type: 'object' } } },
})`

describe('strip-contracts-vite', () => {
  it('strips defineContract call sites during a browser build', () => {
    const plugin = stripContractsVite()
    const result = plugin.transform(contractModule, '/app/src/contracts.ts')
    expect(result?.code).not.toContain('summary')
    expect(result?.code).toContain('body: true')
  })

  it('runs pre and only at build time so it sees raw sources', () => {
    const plugin = stripContractsVite()
    expect(plugin.enforce).toBe('pre')
    expect(plugin.apply).toBe('build')
  })

  it('leaves SSR modules alone — the server reads the schemas', () => {
    const plugin = stripContractsVite()
    expect(plugin.transform(contractModule, '/app/src/contracts.ts', { ssr: true })).toBeNull()
  })

  it('skips non-script ids and modules without defineContract', () => {
    const plugin = stripContractsVite()
    expect(plugin.transform(contractModule, '/app/src/contracts.css')).toBeNull()
    expect(plugin.transform('export const x = 1', '/app/src/x.ts')).toBeNull()
  })

  it('transforms ids carrying Vite query suffixes', () => {
    const plugin = stripContractsVite()
    const result = plugin.transform(contractModule, '/app/src/contracts.ts?v=abc123')
    expect(result?.code).toContain('body: true')
  })
})
