import { validateArray } from '@amritk/helpers/validate-array'
import { validateRecord } from '@amritk/helpers/validate-record'
import { transformSync } from 'esbuild'
import { describe, expect, it } from 'vitest'

import { generateParserFunction } from './generate-parser-function'

/**
 * Compile-and-eval a generated parser with all four runtime helpers injected
 * (the shared harness only wires `isObject`/`validateArray`; the record fix
 * below also needs the real `validateRecord`).
 */
const evalParser = <T>(code: string, exportName: string): T => {
  const js = transformSync(code, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  const mod = { exports: {} as Record<string, unknown> }
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  new Function('module', 'exports', 'isObject', 'validateArray', 'validateRecord', js)(
    mod,
    mod.exports,
    isObject,
    validateArray,
    validateRecord,
  )
  return mod.exports[exportName] as T
}

describe('integer record coercion', () => {
  it('rejects a non-integral number in a Record<string, integer>', () => {
    const schema = { type: 'object', additionalProperties: { type: 'integer' } } as const
    const code = generateParserFunction(schema as never, 'IntRecord', { useRefImports: true })
    expect(code).toContain('Number.isInteger(value)')

    const parse = evalParser<(i: unknown) => Record<string, number>>(code, 'parseIntRecord')
    // `1.5` is a `number` but not an `integer`, so it must coerce to 0; a real
    // integer passes through unchanged.
    expect(parse({ a: 1.5, b: 3 })).toEqual({ a: 0, b: 3 })
  })
})

describe('prototype safety in pattern-property parsers', () => {
  it('does not let a "__proto__" input key reassign the result prototype', () => {
    const schema = {
      type: 'object',
      patternProperties: { '^.*$': { type: 'string' } },
      additionalProperties: false,
    } as const
    const code = generateParserFunction(schema as never, 'Bag', { strict: true })
    const parse = evalParser<(i: unknown) => Record<string, unknown>>(code, 'parseBag')

    // JSON.parse makes `__proto__` an own, enumerable key, so `for..in` sees it
    // and the pattern matches it. A bare `result[key] = v` would fire the
    // Object.prototype `__proto__` setter and corrupt the result's prototype.
    const out = parse(JSON.parse('{"__proto__":{"polluted":true},"a":"x"}'))

    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(Object.hasOwn(out, '__proto__')).toBe(true)
    // No global pollution leaked either.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('a declared property literally named "__proto__"', () => {
  it('materializes as an own property, not the object-literal prototype setter', () => {
    // Built via JSON.parse so `__proto__` is a genuine own key (an object
    // literal would instead set the prototype — the exact hazard under test),
    // matching how a schema loaded from a `.json` file reaches the generator.
    const schema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"]}')
    const code = generateParserFunction(schema as never, 'Weird')
    // Emitted as a computed key so it creates an own property.
    expect(code).toContain('["__proto__"]:')

    const parse = evalParser<(i: unknown) => Record<string, unknown>>(code, 'parseWeird')
    const out = parse(JSON.parse('{"__proto__":"hello"}'))

    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(Object.hasOwn(out, '__proto__')).toBe(true)
    expect(out.__proto__).toBe('hello')
  })
})
