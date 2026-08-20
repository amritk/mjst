import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { collectExampleImports } from './collect-example-imports'
import { deriveExample } from './derive-example'
import { generateArbitrary } from './generate-arbitrary'

/**
 * Every recursion in this package used to die on a pathologically nested
 * document with a bare `RangeError: Maximum call stack size exceeded`, thrown
 * from whichever helper happened to be deepest — a trace that names nothing
 * about the input that caused it. A nesting like this is legal JSON and parses
 * fine, so it arrives as ordinary untrusted input.
 */
const nest = (levels: number): JSONSchema => {
  let schema: JSONSchema = { type: 'string' }
  for (let i = 0; i < levels; i++) {
    schema = { type: 'object', properties: { a: schema }, required: ['a'] }
  }
  return schema
}

const generators: ReadonlyArray<{ name: string; run: (schema: JSONSchema) => unknown }> = [
  { name: 'generateArbitrary', run: (schema) => generateArbitrary(schema, 'Deep') },
  { name: 'deriveExample', run: (schema) => deriveExample(schema) },
  { name: 'collectExampleImports', run: (schema) => collectExampleImports(schema) },
]

describe('deeply nested schemas', () => {
  const shallow = nest(50)
  const deep = nest(3000)

  for (const { name, run } of generators) {
    it(`handles ordinary nesting: ${name}`, () => {
      expect(() => run(shallow)).not.toThrow()
    })

    it(`names the nesting limit rather than overflowing the stack: ${name}`, () => {
      let thrown: unknown
      try {
        run(deep)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).name).not.toBe('RangeError')
      expect((thrown as Error).message).toContain('Schema nesting exceeds')
      expect((thrown as Error).message).toContain(name)
    })
  }
})
