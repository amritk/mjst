import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { VALIDATION_RESULT_CONTENT } from './build-schema'

/**
 * `@amritk/helpers/coercion-runtime` is the copy of the validator's runtime a
 * coercing parser imports. The two must be the same code: a parser that agrees
 * with `coerceX` on every document is only as good as the two agreeing on what
 * `"1e3"` is, and two implementations of that are two answers waiting to part.
 */
const helperSource = (): string => {
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve('@amritk/helpers/package.json'))
  return readFileSync(resolve(root, 'src', 'coercion-runtime.ts'), 'utf-8')
}

describe('coercion-runtime', () => {
  it('ships the validator runtime byte for byte', () => {
    const source = helperSource()
    // Everything after the module's own header comment.
    const body = source.slice(source.indexOf('*/') + 2).trim()

    expect(body.length).toBeGreaterThan(1000)
    expect(VALIDATION_RESULT_CONTENT).toContain(body)
  })
})
