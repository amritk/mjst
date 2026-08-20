import { appendFileSync } from 'node:fs'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, it } from 'vitest'

import { generateExampleFile } from './generate-files'

const OUT = '/tmp/claude-0/-home-user-mjst/63e05456-bf74-516f-9d18-7ce10a068c10/scratchpad/a.txt'
const log = (s: string): void => appendFileSync(OUT, s + '\n')

const tryGen = (name: string, schema: unknown, rootSchema?: Record<string, unknown>): void => {
  log('=== ' + name)
  try {
    const code = generateExampleFile(schema as JSONSchema, 'Foo', rootSchema ? { rootSchema } : undefined)
    log(code)
  } catch (e) {
    log('THREW: ' + (e as Error).stack?.split('\n').slice(0, 6).join('\n'))
  }
}

describe('probe a', () => {
  it('runs', () => {
    // A. mergeAllOf __proto__ property
    tryGen('allOf-proto-prop', JSON.parse('{"allOf":[{"type":"object","properties":{"__proto__":{"type":"string"}}}]}'))
    // A2. mergeAllOf with __proto__ key at top of a branch
    tryGen('allOf-proto-key', JSON.parse('{"allOf":[{"__proto__":{"type":"string"}},{"type":"object"}]}'))
    // B. default / examples type mismatch
    tryGen('default-mismatch', { type: 'string', default: 42 })
    tryGen('examples-mismatch', { type: 'number', examples: ['hello'] })
    tryGen('const-mismatch', { type: 'string', const: 42 })
    // C. invalid pattern
    tryGen('bad-pattern', { type: 'string', pattern: '[' })
    tryGen('bad-patternProperties', { type: 'object', patternProperties: { '[': { type: 'string' } } })
    // D. negative / fractional size bounds
    tryGen('neg-maxItems', { type: 'array', maxItems: -1, items: { type: 'string' } })
    tryGen('frac-maxItems', { type: 'array', maxItems: 2.5, items: { type: 'string' } })
    tryGen('neg-maxLength', { type: 'string', maxLength: -1 })
    tryGen('frac-maxLength', { type: 'string', maxLength: 2.5 })
    tryGen('neg-maxProperties', { type: 'object', maxProperties: -1, additionalProperties: { type: 'string' } })
    // E. multipleOf Infinity
    tryGen('multipleOf-inf', JSON.parse('{"type":"number","multipleOf":1e999}'))
    // F. huge minimum
    tryGen('huge-min-int', JSON.parse('{"type":"integer","minimum":1e999}'))
    tryGen('big-min-int', { type: 'integer', minimum: 1e30 })
    tryGen('huge-min-num', JSON.parse('{"type":"number","minimum":1e999}'))
    // G. empty enum
    tryGen('empty-enum', { enum: [] })
    // H. non-string required entries
    tryGen('numeric-required', { type: 'object', properties: { a: { type: 'string' } }, required: [1] })
  })
})
