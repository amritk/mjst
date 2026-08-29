import { describe, expect, it } from 'vitest'

import { rebaseComponentRefs } from './rebase-component-refs'
import type { ExtractionIssue } from './types'

const document = {
  asyncapi: '3.0.0',
  components: {
    schemas: {
      user: { type: 'object', properties: { pet: { $ref: '#/components/schemas/pet' } } },
      pet: { type: 'object', properties: { owner: { $ref: '#/components/schemas/user' } } },
      wrapped: {
        schemaFormat: 'application/schema+json;version=draft-2020-12',
        schema: { type: 'string' },
      },
      avro: { schemaFormat: 'application/vnd.apache.avro;version=1.9.0', schema: { type: 'record' } },
      form: {
        type: 'object',
        properties: { name: { $ref: '#/definitions/nameType' } },
        definitions: { nameType: { type: 'string', minLength: 1 } },
      },
    },
  },
}

describe('rebase-component-refs', () => {
  it('copies referenced components into $defs and rewrites the refs', () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs(
      { type: 'object', properties: { user: { $ref: '#/components/schemas/user' } } },
      document,
      'asyncapi',
      issues,
      '#/x',
    )
    expect((rebased['properties'] as Record<string, unknown>)['user']).toEqual({ $ref: '#/$defs/user' })
    const defs = rebased['$defs'] as Record<string, Record<string, unknown>>
    // `pet` arrives transitively through `user`, and the cycle back terminates.
    expect(Object.keys(defs).sort()).toEqual(['pet', 'user'])
    expect(JSON.stringify(rebased)).not.toContain('#/components/')
    expect(issues).toEqual([])
  })

  it('keeps a deeper pointer tail on the rewritten ref', () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs(
      { $ref: '#/components/schemas/user/properties/pet' },
      document,
      'asyncapi',
      issues,
      '#/x',
    )
    expect(rebased['$ref']).toBe('#/$defs/user/properties/pet')
    expect((rebased['$defs'] as Record<string, unknown>)['user']).toBeDefined()
  })

  it('unwraps a multi-format component with its own dialect', () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs({ $ref: '#/components/schemas/wrapped' }, document, 'asyncapi', issues, '#/x')
    expect((rebased['$defs'] as Record<string, unknown>)['wrapped']).toEqual({ type: 'string' })
  })

  it('turns an unsupported-format component into an unconstrained schema with an issue', () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs({ $ref: '#/components/schemas/avro' }, document, 'asyncapi', issues, '#/x')
    expect((rebased['$defs'] as Record<string, unknown>)['avro']).toEqual({})
    expect(issues[0]?.message).toContain('avro')
  })

  it('turns a ref to an undeclared component into an unconstrained schema with an issue', () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs({ $ref: '#/components/schemas/ghost' }, document, 'asyncapi', issues, '#/x')
    expect(rebased['$ref']).toBe('#/$defs/ghost')
    expect((rebased['$defs'] as Record<string, unknown>)['ghost']).toEqual({})
    expect(issues[0]?.message).toContain('undeclared component')
  })

  it('moves a component aside when the root already claims its name in $defs', () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs(
      {
        type: 'object',
        properties: { remote: { $ref: '#/components/schemas/user' }, local: { $ref: '#/$defs/user' } },
        $defs: { user: { type: 'string' } },
      },
      document,
      'asyncapi',
      issues,
      '#/x',
    )
    const defs = rebased['$defs'] as Record<string, Record<string, unknown>>
    // The root's own definition survives untouched; the component gets a
    // prefixed key and the remote ref follows it there.
    expect(defs['user']).toEqual({ type: 'string' })
    expect((rebased['properties'] as Record<string, Record<string, unknown>>)['remote']?.['$ref']).toBe(
      '#/$defs/component-user',
    )
    expect(defs['component-user']?.['type']).toBe('object')
  })

  it("hoists a copied component's own definitions to the root and re-aims its refs", () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs({ $ref: '#/components/schemas/form' }, document, 'asyncapi', issues, '#/x')
    const defs = rebased['$defs'] as Record<string, Record<string, unknown>>
    // The component body sits at its own key, its definitions beside it —
    // never nested, where their `#/$defs/...` refs would resolve against the
    // message root and land on nothing.
    expect(Object.keys(defs).sort()).toEqual(['form', 'form-nameType'])
    expect(defs['form-nameType']).toEqual({ type: 'string', minLength: 1 })
    expect((defs['form']?.['properties'] as Record<string, unknown>)['name']).toEqual({ $ref: '#/$defs/form-nameType' })
    expect(defs['form']?.['$defs']).toBeUndefined()
    expect(issues).toEqual([])
  })

  it('re-aims a pointer tail that dives through a component definitions block', () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs(
      { $ref: '#/components/schemas/form/definitions/nameType' },
      document,
      'asyncapi',
      issues,
      '#/x',
    )
    // The block was renamed and hoisted, so the tail's old spelling would
    // dangle — the ref lands directly on the hoisted entry instead.
    expect(rebased['$ref']).toBe('#/$defs/form-nameType')
    expect((rebased['$defs'] as Record<string, unknown>)['form-nameType']).toEqual({ type: 'string', minLength: 1 })
    expect(issues).toEqual([])
  })

  it('turns a tail naming an undeclared definition into an unconstrained schema with an issue', () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs(
      { $ref: '#/components/schemas/form/definitions/ghost' },
      document,
      'asyncapi',
      issues,
      '#/x',
    )
    expect(rebased['$ref']).toBe('#/$defs/form-ghost')
    expect((rebased['$defs'] as Record<string, unknown>)['form-ghost']).toEqual({})
    expect(issues.some((issue) => issue.message.includes('ghost'))).toBe(true)
  })

  it('hoists a definitions block a 2020-12 component keeps verbatim', () => {
    // Normalization renames `definitions` only for the draft-07 families, but
    // pointer tails re-aim unconditionally — without hoisting from the raw
    // block, the tail's target became `{}` plus a false "does not declare"
    // issue while the component declared it right there.
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs(
      { $ref: '#/components/schemas/form/definitions/nameType' },
      document,
      '2020-12',
      issues,
      '#/x',
    )
    expect((rebased['$defs'] as Record<string, unknown>)['form-nameType']).toEqual({ type: 'string', minLength: 1 })
    expect(issues).toEqual([])
  })

  it('degrades a ref diving through nested definitions with an issue instead of dangling', () => {
    const issues: ExtractionIssue[] = []
    const nested = {
      asyncapi: '3.0.0',
      components: {
        schemas: {
          X: { type: 'object', definitions: { a: { type: 'object', definitions: { b: { type: 'string' } } } } },
        },
      },
    }
    const rebased = rebaseComponentRefs(
      { $ref: '#/components/schemas/X/definitions/a/definitions/b' },
      nested,
      'asyncapi',
      issues,
      '#/x',
    )
    // The first hop's target is hoisted but blocks nested inside it move too,
    // so the deeper dive has no stable target — an unconstrained schema with a
    // warning beats emitting a pointer the generators would throw on.
    const target = (rebased['$defs'] as Record<string, unknown>)[(rebased['$ref'] as string).split('/')[2] as string]
    expect(target).toEqual({})
    expect(issues.some((issue) => issue.message.includes('nested definitions'))).toBe(true)
  })

  it('keeps percent escapes out of emitted $defs keys', () => {
    // The generators percent-decode $ref pointers, so a `%` surviving into a
    // key makes the emitted ref and the key disagree after decoding — the
    // whole message failed generation.
    const issues: ExtractionIssue[] = []
    const escaped = {
      asyncapi: '2.6.0',
      components: { schemas: { 'foo%20bar': { type: 'string' } } },
    }
    const rebased = rebaseComponentRefs({ $ref: '#/components/schemas/foo%20bar' }, escaped, 'asyncapi', issues, '#/x')
    const ref = rebased['$ref'] as string
    expect(ref).not.toContain('%')
    expect((rebased['$defs'] as Record<string, unknown>)[ref.replace('#/$defs/', '')]).toEqual({ type: 'string' })
    expect(issues).toEqual([])
  })

  it('leaves refs inside instance data alone', () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs(
      { type: 'object', default: { $ref: '#/components/schemas/user' } },
      document,
      'asyncapi',
      issues,
      '#/x',
    )
    // The `default` value is data the author wrote, not a reference.
    expect(rebased['default']).toEqual({ $ref: '#/components/schemas/user' })
    expect(rebased['$defs']).toBeUndefined()
  })
})
