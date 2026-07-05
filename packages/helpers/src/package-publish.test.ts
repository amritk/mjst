import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guards the published file set. Embedded-mode parser generation copies this
 * package's `src/*.ts` helper sources into the generated output, so those sources
 * must be part of the published tarball — omitting them (as an earlier `files:
 * ["dist"]` did) is what made `bunx mjst` crash on a missing `src/is-object.ts`.
 */
describe('package publish config', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf-8')) as {
    files?: string[]
  }

  it('publishes the runtime-helper TypeScript sources for embedded mode', () => {
    expect(pkg.files).toContain('src/**/*.ts')
  })

  it('excludes test files from the published tarball', () => {
    expect(pkg.files).toContain('!src/**/*.test.ts')
  })
})
