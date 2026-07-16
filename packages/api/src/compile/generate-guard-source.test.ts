import { describe, expect, it } from 'vitest'

import { generateGuardSource } from './generate-guard-source'

describe('generate-guard-source', () => {
  it('inlines a flat object of bare primitives', () => {
    const guard = generateGuardSource(
      {
        type: 'object',
        properties: { id: { type: 'integer' }, name: { type: 'string' }, active: { type: 'boolean' } },
        required: ['id', 'name'],
      },
      'g',
    )
    expect(guard?.expression).toContain("typeof input !== 'object' || input === null || Array.isArray(input)")
    expect(guard?.expression).toContain('if (!Number.isInteger(v0)) return false')
    // Required keys get an explicit presence check before their own checks.
    expect(guard?.expression).toContain('if (v0 === undefined) return false')
    // Optional property: only checked when present.
    expect(guard?.expression).toContain('if (v2 !== undefined) {')
  })

  it('inlines string lengths (code points), pattern, and numeric bounds', () => {
    const guard = generateGuardSource(
      {
        type: 'object',
        properties: {
          unit: { type: 'string', minLength: 1, maxLength: 8, pattern: '^[a-z]+$' },
          value: { type: 'number', minimum: 0, exclusiveMaximum: 100 },
        },
        required: ['unit', 'value'],
      },
      'metric',
    )
    expect(guard?.usesCodePoints).toBe(true)
    expect(guard?.usesCompileRx).toBe(true)
    expect(guard?.expression).toContain('codePoints(v0) < 1')
    expect(guard?.expression).toContain('codePoints(v0) > 8')
    expect(guard?.declarations.join('\n')).toMatch(/const metric_rx\d+ = compileRx\("\^\[a-z\]\+\$"\)/)
    expect(guard?.expression).toMatch(/metric_rx\d+\.test\(v0\)/)
    expect(guard?.expression).toContain('if (v2 < 0) return false')
    expect(guard?.expression).toContain('if (v2 >= 100) return false')
  })

  it('inlines enum, const, nullable, closed objects, and primitive arrays', () => {
    const guard = generateGuardSource(
      {
        type: 'object',
        properties: {
          kind: { enum: ['a', 'b'] },
          version: { const: 2 },
          note: { type: 'string', nullable: true },
          tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
          nested: { type: 'object', properties: { on: { type: 'boolean' } }, additionalProperties: false },
        },
        required: ['kind'],
        additionalProperties: false,
      },
      'g',
    )
    expect(guard?.expression).toContain('v0 !== "a" && v0 !== "b"')
    expect(guard?.expression).toContain('v1 !== 2')
    // nullable: all other checks nest under a null bypass.
    expect(guard?.expression).toContain('if (v2 !== null) {')
    expect(guard?.expression).toContain('.length < 1')
    expect(guard?.expression).toContain('.length > 3')
    // Closed root object: unknown keys rejected with a for-in scan.
    expect(guard?.expression).toMatch(/for \(const k\d+ in input\) if \(/)
    // Closed empty-ish nested object still scans.
    expect(guard?.expression).toMatch(/for \(const k\d+ in v\d+\)/)
  })

  it('supports primitive type unions without other constraints', () => {
    const guard = generateGuardSource({ type: 'object', properties: { v: { type: ['string', 'null'] } } }, 'g')
    expect(guard?.expression).toContain("(typeof v0 === 'string') || (v0 === null)")
    expect(
      generateGuardSource({ type: 'object', properties: { v: { type: ['string', 'null'], minLength: 1 } } }, 'g'),
    ).toBeUndefined()
  })

  it('ignores annotation keywords, exactly like the interpreter', () => {
    const guard = generateGuardSource(
      {
        type: 'object',
        title: 'User',
        description: 'a user',
        properties: { email: { type: 'string', format: 'email', description: 'contact' } },
      },
      'g',
    )
    expect(guard).toBeDefined()
    expect(guard?.expression).not.toContain('email@')
  })

  it('bails on any keyword outside the subset', () => {
    const bails: unknown[] = [
      { type: 'object', properties: { n: { type: 'number', multipleOf: 2 } } },
      { type: 'object', properties: { n: { type: 'array', uniqueItems: true } } },
      { type: 'object', patternProperties: { '^x-': {} } },
      { type: 'object', properties: {}, additionalProperties: true },
      { type: 'object', properties: {}, additionalProperties: { type: 'string' } },
      { type: 'object', properties: { n: { anyOf: [{ type: 'string' }] } } },
      { type: 'object', properties: { n: { enum: [{ deep: true }] } } },
      { type: 'object', properties: { n: { const: { deep: true } } } },
      // Draft-04 boolean exclusiveMinimum changes meaning.
      { type: 'object', properties: { n: { type: 'number', minimum: 0, exclusiveMinimum: true } } },
      // Prototype-member keys need hasOwn presence semantics.
      { type: 'object', properties: { toString: { type: 'string' } } },
      { type: 'object', properties: {}, required: ['valueOf'] },
      { type: 'strng' },
    ]
    for (const schema of bails) {
      expect(generateGuardSource(schema, 'g'), JSON.stringify(schema)).toBeUndefined()
    }
  })
})
