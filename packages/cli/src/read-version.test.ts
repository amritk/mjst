import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { readVersion } from './read-version'

describe('read-version', () => {
  it('returns the version declared in the package.json', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8')) as {
      version: string
    }

    expect(await readVersion()).toBe(pkg.version)
  })

  it('returns a semver-shaped string', async () => {
    expect(await readVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })
})
