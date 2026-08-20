import { describe, expect, it } from 'vitest'

import { compileFilter } from './filter'
import { compileQuery, query } from './jsonpath'

// The context a filter is handed for one node, in the positional order
// `FilterFn` takes: value, property, parent, root, path, parentProperty.
const run = (source: string, value: unknown, extras: Partial<Record<string, unknown>> = {}): boolean | string => {
  const compiled = compileFilter(source)
  if ('error' in compiled) return compiled.error
  return compiled.test(
    value,
    extras['property'] as string | number | undefined,
    extras['parent'],
    extras['root'],
    (extras['path'] as string) ?? '',
    extras['parentProperty'] as string | number | undefined,
  )
}

describe('filter', () => {
  it('evaluates the shapes the shipped oas ruleset relies on', () => {
    // The `oas-example-value` given, reduced to one node.
    const exampleGiven =
      "@property !== 'properties' && @property !== 'patternProperties' && @ && (@.example !== void 0 || @.default !== void 0) && (@.type || @.enum || @.format || @.$ref || @.properties || @.items || @.allOf || @.anyOf || @.oneOf)"
    expect(run(exampleGiven, { type: 'string', example: 'x' }, { property: 'Pet' })).toBe(true)
    // A node under `properties` is excluded, however schema-shaped it looks.
    expect(run(exampleGiven, { type: 'string', example: 'x' }, { property: 'properties' })).toBe(false)
    // No example and no default: nothing to validate.
    expect(run(exampleGiven, { type: 'string' }, { property: 'Pet' })).toBe(false)
    // An example on something that is not a schema.
    expect(run(exampleGiven, { example: 'x' }, { property: 'Pet' })).toBe(false)

    expect(run("@ && @.type === 'array'", { type: 'array' })).toBe(true)
    expect(run("@ && @.type === 'array'", { type: 'object' })).toBe(false)
    expect(run("@ && @.type === 'array'", null)).toBe(false)

    expect(run('@ && @.schema && @.examples', { schema: {}, examples: {} })).toBe(true)
    expect(run('@ && @.schema && @.examples', { schema: {} })).toBe(false)
  })

  it('refuses to execute code hidden in a filter body', () => {
    // Every one of these ran as JavaScript before the expression parser existed.
    const payloads = [
      "globalThis.__p = import('node:fs')",
      'globalThis.__x = {pid: process.pid}',
      "@.constructor.constructor('return process')()",
      'this',
      '(() => 1)()',
      'process.env.HOME',
      '@.a; process.exit(1)',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: this is an injection payload, not a template literal we forgot to tag
      '`${process.env.HOME}`',
    ]
    for (const payload of payloads) {
      const compiled = compileFilter(payload)
      expect(compiled, payload).toHaveProperty('error')
    }
  })

  it('reads own properties only, so the prototype chain is unreachable', () => {
    // Grammatical, but it can only ever see data: `constructor` is not an own
    // property of a parsed document node, so this is `undefined`, not a function.
    expect(run("@['__proto__']", { a: 1 })).toBe(false)
    expect(run('@.constructor', { a: 1 })).toBe(false)
    expect(run("@['constructor']['name']", { a: 1 })).toBe(false)
    expect(run('@.a', { a: 1 })).toBe(true)
  })

  it('surfaces an unsupported expression as a ruleset error, never as a silent non-match', () => {
    const compiled = compileQuery('$[?(@.name.split("-").length > 1)]')
    expect(compiled.error).toContain('split')
    // And a rule carrying it fails to build rather than quietly matching nothing.
    expect(query({ a: { name: 'a-b' } }, '$[?(@.name.split("-").length > 1)]')).toEqual([])
  })

  it('supports comparisons, logic, literals, and parentheses', () => {
    expect(run('@.n > 5', { n: 9 })).toBe(true)
    expect(run('@.n >= 9 && @.n <= 9', { n: 9 })).toBe(true)
    expect(run("@.n == '9'", { n: 9 })).toBe(true)
    expect(run("@.n === '9'", { n: 9 })).toBe(false)
    expect(run('@.n != 9', { n: 9 })).toBe(false)
    expect(run('!(@.n < 5)', { n: 9 })).toBe(true)
    expect(run('@.n === -1', { n: -1 })).toBe(true)
    expect(run('@.flag === true || @.other === null', { flag: false, other: null })).toBe(true)
    expect(run('@.missing === undefined', {})).toBe(true)
    expect(run('@.missing !== void 0', {})).toBe(false)
    expect(run('@.name.length > 2', { name: 'abc' })).toBe(true)
    expect(run('@.list.length === 2', { list: [1, 2] })).toBe(true)
  })

  it('supports the string and regex methods rulesets use', () => {
    expect(run("@.name.indexOf('-') === -1", { name: 'ab' })).toBe(true)
    expect(run('@.name.match(/^get[A-Z]/)', { name: 'getPet' })).toBe(true)
    expect(run('/\\{.*\\}/.test(@property)', undefined, { property: '/pets/{id}' })).toBe(true)
    expect(run('/\\{.*\\}/.test(@property)', undefined, { property: '/pets' })).toBe(false)
    expect(run("@.name.startsWith('x') || @.name.endsWith('z')", { name: 'abz' })).toBe(true)
    expect(run("@.name.toLowerCase() === 'abc'", { name: 'ABC' })).toBe(true)
    expect(run("@.tags.includes('a')", { tags: ['a', 'b'] })).toBe(true)
  })

  it('does not match when a filter cannot be evaluated against this node', () => {
    // `@.a.b` on a node without `a` is a TypeError in JavaScript; the node simply
    // does not match, which is what rulesets written this way expect.
    expect(run('@.a.b === 1', {})).toBe(false)
    expect(run('@.name.match(/x/)', { name: 7 })).toBe(false)
  })

  it('exposes the context tokens, including $ as the document root', () => {
    const document = { parent: { a: 1 } }
    expect(run('@root.parent && @property === "a"', 1, { root: document, property: 'a' })).toBe(true)
    expect(run('$.parent && @property === "a"', 1, { root: document, property: 'a' })).toBe(true)
    expect(run("@parentProperty === 'list'", 1, { parentProperty: 'list' })).toBe(true)
    expect(run('@parent.a === 1', 1, { parent: { a: 1 } })).toBe(true)
    expect(run('@path === "$[\'items\'][1]"', 1, { path: "$['items'][1]" })).toBe(true)
  })

  it('keeps a literal @ inside a string intact', () => {
    expect(run("@.indexOf('@') === -1", 'no at sign')).toBe(true)
    expect(run("@.indexOf('@') === -1", 'has@at')).toBe(false)
  })

  it('reports where an expression went wrong', () => {
    const compiled = compileFilter('@.a ===')
    expect(compiled).toHaveProperty('error')
    if ('error' in compiled) expect(compiled.error).toContain('offset')
  })

  it('refuses an expression nested past the depth cap, deterministically', () => {
    // The parser is recursive descent, so nesting depth is stack depth. Left
    // uncapped, `'('.repeat(20000)` failed with "Maximum call stack size
    // exceeded at offset undefined" — a message that says nothing, at a
    // threshold that differs between Node, Bun, and an edge runtime.
    const nested = compileFilter(`${'('.repeat(20_000)}@${')'.repeat(20_000)}`)
    expect(nested).toHaveProperty('error')
    if ('error' in nested) {
      expect(nested.error).toContain('nests deeper than')
      // The whole expression would otherwise be echoed into a thrown ruleset error.
      expect(nested.error.length).toBeLessThan(300)
    }
    // Anything a real filter would write still compiles.
    expect(compileFilter(`${'('.repeat(99)}@${')'.repeat(99)}`)).not.toHaveProperty('error')
  })

  it('memoizes compilation by source', () => {
    expect(compileFilter('@.type')).toBe(compileFilter('@.type'))
  })
})
