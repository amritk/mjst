import { describe, expect, it } from 'vitest'

import { buildSchema } from './index'

/**
 * The engine itself is tested where it now lives, inside `@amritk/parsers`.
 * What is left to prove here is only that this package still hands callers the
 * same function: the shim is the whole package, so a broken re-export is the
 * one failure mode it has.
 */
describe('@amritk/generate-parsers forwards to the moved engine', () => {
  it('re-exports a buildSchema that still emits parser files', async () => {
    const files = await buildSchema(
      { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      'User',
      undefined,
      false,
      false,
      false,
      'embedded',
      './',
      false,
      false,
    )

    expect(files.map((file) => file.filename)).toContain('user.ts')
    expect(files.find((file) => file.filename === 'user.ts')?.content).toContain('export type User')
  })
})
