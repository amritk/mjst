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

  it('degrades a bare definitions-block tail instead of dangling on the stripped copy', () => {
    // `#/components/schemas/form/definitions` resolves in the source document
    // (to the block itself, a vacuously valid schema), but the copy strips
    // that block — the kept tail dangled with no issue, aborting generation.
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs(
      { $ref: '#/components/schemas/form/definitions' },
      document,
      'asyncapi',
      issues,
      '#/x',
    )
    expect(rebased['$ref']).toBe('#/$defs/unsupported-pointer')
    expect((rebased['$defs'] as Record<string, unknown>)['unsupported-pointer']).toEqual({})
    expect(issues.some((issue) => issue.message.includes('definitions block'))).toBe(true)
  })

  it('degrades a tail into a Multi Format wrapper key the copy does not keep', () => {
    // The copy is the unwrapped schema: `/schema` hops are stripped, but a
    // tail into `/schemaFormat` (or any other wrapper key) has no target.
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs(
      { $ref: '#/components/schemas/wrapped/schemaFormat' },
      document,
      'asyncapi',
      issues,
      '#/x',
    )
    expect(rebased['$ref']).toBe('#/$defs/unsupported-pointer')
    expect((rebased['$defs'] as Record<string, unknown>)['unsupported-pointer']).toEqual({})
    expect(issues.some((issue) => issue.message.includes('wrapper key'))).toBe(true)
  })

  it('degrades a component-internal ref diving through nested definitions too', () => {
    // Same hazard as the external spelling above, one scope deeper: the
    // component's own `#/definitions/parent/definitions/child` re-aims its
    // first hop at the hoisted `Form-parent` entry, but the upgrade renames
    // the block nested *inside* that entry, so the kept tail dangled.
    const issues: ExtractionIssue[] = []
    const nested = {
      asyncapi: '3.0.0',
      components: {
        schemas: {
          Form: {
            type: 'object',
            properties: { child: { $ref: '#/definitions/parent/definitions/child' } },
            definitions: { parent: { type: 'object', definitions: { child: { type: 'string' } } } },
          },
        },
      },
    }
    const rebased = rebaseComponentRefs({ $ref: '#/components/schemas/Form' }, nested, 'asyncapi', issues, '#/x')
    const defs = rebased['$defs'] as Record<string, Record<string, unknown>>
    const child = (defs['Form']?.['properties'] as Record<string, Record<string, unknown>>)['child']
    expect(child?.['$ref']).toBe('#/$defs/unsupported-pointer')
    expect(defs['unsupported-pointer']).toEqual({})
    expect(issues.some((issue) => issue.message.includes('dives through nested definitions'))).toBe(true)
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

  it('recognizes percent-spelled block keywords the way the resolver does', () => {
    // RFC 6901 evaluates URI-fragment pointers percent-decoded, so
    // `/%24defs/x` names the `$defs` block — the resolver follows it, and a
    // literal-only match appended the encoded segment verbatim onto a copy
    // whose block was hoisted away, a silent dangling ref.
    const issues: ExtractionIssue[] = []
    const encoded = {
      asyncapi: '3.0.0',
      components: {
        schemas: {
          A: {
            type: 'object',
            properties: { x: { $ref: '#/%24defs/x' } },
            $defs: { x: { type: 'string' } },
          },
        },
      },
    }
    const tailed = rebaseComponentRefs({ $ref: '#/components/schemas/A/%24defs/x' }, encoded, '2020-12', issues, '#/x')
    expect(tailed['$ref']).toBe('#/$defs/A-x')
    expect((tailed['$defs'] as Record<string, unknown>)['A-x']).toEqual({ type: 'string' })

    const internal = rebaseComponentRefs({ $ref: '#/components/schemas/A' }, encoded, '2020-12', issues, '#/x')
    const defs = internal['$defs'] as Record<string, Record<string, unknown>>
    expect((defs['A']?.['properties'] as Record<string, Record<string, unknown>>)['x']?.['$ref']).toBe('#/$defs/A-x')
    expect(issues).toEqual([])
  })

  it("strips the wrapper hop from a tail through a Multi Format component's schema key", () => {
    // The copy is the unwrapped schema, so the pointer-faithful `/schema` hop
    // has no level to land on — kept verbatim, buildSchema threw and the
    // whole run aborted.
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs(
      { type: 'object', properties: { id: { $ref: '#/components/schemas/wrapped/schema' } } },
      document,
      'asyncapi',
      issues,
      '#/x',
    )
    expect((rebased['properties'] as Record<string, Record<string, unknown>>)['id']?.['$ref']).toBe('#/$defs/wrapped')
    expect((rebased['$defs'] as Record<string, unknown>)['wrapped']).toEqual({ type: 'string' })
    expect(issues).toEqual([])
  })

  it('does not mistake a property named definitions for a block hop', () => {
    const issues: ExtractionIssue[] = []
    const tricky = {
      asyncapi: '3.0.0',
      components: {
        schemas: {
          A: {
            definitions: {
              x: {
                type: 'object',
                properties: { definitions: { type: 'object', properties: { y: { type: 'number' } } } },
              },
            },
          },
        },
      },
    }
    const rebased = rebaseComponentRefs(
      { $ref: '#/components/schemas/A/definitions/x/properties/definitions/properties/y' },
      tricky,
      'asyncapi',
      issues,
      '#/x',
    )
    // The second `definitions` is a property name inside the hoisted def, so
    // the tail stays and resolves — no false "unsupported pointer" degrade.
    expect(rebased['$ref']).toBe('#/$defs/A-x/properties/definitions/properties/y')
    const hoisted = (rebased['$defs'] as Record<string, Record<string, unknown>>)['A-x']
    expect((hoisted?.['properties'] as Record<string, unknown>)['definitions']).toBeDefined()
    expect(issues).toEqual([])
  })

  it('keeps definitions.x and $defs.x apart when a component declares both', () => {
    const issues: ExtractionIssue[] = []
    const both = {
      asyncapi: '3.0.0',
      components: {
        schemas: {
          A: {
            schemaFormat: 'application/schema+json;version=draft-2020-12',
            schema: { type: 'object', definitions: { x: { type: 'integer' } }, $defs: { x: { type: 'string' } } },
          },
        },
      },
    }
    const rebased = rebaseComponentRefs(
      {
        type: 'object',
        properties: {
          p: { $ref: '#/components/schemas/A/definitions/x' },
          q: { $ref: '#/components/schemas/A/$defs/x' },
        },
      },
      both,
      '2020-12',
      issues,
      '#/x',
    )
    const defs = rebased['$defs'] as Record<string, Record<string, unknown>>
    const properties = rebased['properties'] as Record<string, Record<string, string>>
    const pKey = (properties['p']?.['$ref'] as string).replace('#/$defs/', '')
    const qKey = (properties['q']?.['$ref'] as string).replace('#/$defs/', '')
    // Two different schemas must stay two different entries.
    expect(pKey).not.toBe(qKey)
    expect(defs[pKey]).toEqual({ type: 'integer' })
    expect(defs[qKey]).toEqual({ type: 'string' })
    expect(issues).toEqual([])
  })

  it('copies a document-root $defs target the cross-file resolver hoisted', () => {
    // resolveRefsFromFile resolves a reference cycle by hoisting the target
    // onto the DOCUMENT root's $defs and rewriting the ref to #/$defs/<name>;
    // extraction lifts only the payload subtree, so without copying the
    // target in, the ref dangled and the generators aborted the whole run.
    const issues: ExtractionIssue[] = []
    const hoistedCycle = {
      asyncapi: '2.6.0',
      $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } } },
    }
    const rebased = rebaseComponentRefs({ $ref: '#/$defs/node' }, hoistedCycle, 'asyncapi', issues, '#/x')
    const defs = rebased['$defs'] as Record<string, Record<string, unknown>>
    expect(rebased['$ref']).toBe('#/$defs/node')
    // The copy keeps the self-reference resolvable within the extracted schema.
    expect((defs['node']?.['properties'] as Record<string, Record<string, unknown>>)['next']?.['$ref']).toBe(
      '#/$defs/node',
    )
    expect(issues).toEqual([])
  })

  it('copies a document-root $defs target referenced from inside a component', () => {
    // The resolver plants its hoisted-cycle refs inside components too; the
    // component scope used to return such a ref unrewritten, leaving it
    // dangling (or silently resolving against an unrelated payload-root def).
    const issues: ExtractionIssue[] = []
    const shared = {
      asyncapi: '3.0.0',
      $defs: { Shared: { type: 'string' } },
      components: { schemas: { A: { type: 'object', properties: { s: { $ref: '#/$defs/Shared' } } } } },
    }
    const rebased = rebaseComponentRefs({ $ref: '#/components/schemas/A' }, shared, 'asyncapi', issues, '#/x')
    const defs = rebased['$defs'] as Record<string, Record<string, unknown>>
    const componentRef = ((defs['A']?.['properties'] as Record<string, Record<string, string>>)['s']?.['$ref'] ??
      '') as string
    expect(defs[componentRef.replace('#/$defs/', '')]).toEqual({ type: 'string' })
    expect(issues).toEqual([])
  })

  it('keeps a component ref to a document-root name distinct from a same-named payload def', () => {
    const issues: ExtractionIssue[] = []
    const shared = {
      asyncapi: '3.0.0',
      $defs: { Shared: { type: 'string' } },
      components: { schemas: { A: { type: 'object', properties: { s: { $ref: '#/$defs/Shared' } } } } },
    }
    const rebased = rebaseComponentRefs(
      {
        type: 'object',
        properties: { a: { $ref: '#/components/schemas/A' }, own: { $ref: '#/$defs/Shared' } },
        $defs: { Shared: { type: 'integer' } },
      },
      shared,
      'asyncapi',
      issues,
      '#/x',
    )
    const defs = rebased['$defs'] as Record<string, Record<string, unknown>>
    // The payload's own def keeps its name and its integer shape...
    expect(defs['Shared']).toEqual({ type: 'integer' })
    // ...while the component's ref lands on a copy of the DOCUMENT root's string.
    const componentRef = ((defs['A']?.['properties'] as Record<string, Record<string, string>>)['s']?.['$ref'] ??
      '') as string
    expect(componentRef).not.toBe('#/$defs/Shared')
    expect(defs[componentRef.replace('#/$defs/', '')]).toEqual({ type: 'string' })
    expect(issues).toEqual([])
  })

  it('does not mistake a dependencies entry named definitions for a block hop', () => {
    // Draft-07 `dependencies` keys are author-chosen property names, exactly
    // like `properties` keys — the structural walk must skip them too.
    const issues: ExtractionIssue[] = []
    const tricky = {
      asyncapi: '3.0.0',
      components: {
        schemas: {
          A: {
            type: 'object',
            definitions: { d: { type: 'object', dependencies: { definitions: { type: 'string' } } } },
          },
        },
      },
    }
    const rebased = rebaseComponentRefs(
      { $ref: '#/components/schemas/A/definitions/d/dependencies/definitions' },
      tricky,
      'asyncapi',
      issues,
      '#/x',
    )
    expect(rebased['$ref']).toBe('#/$defs/A-d/dependencies/definitions')
    const hoisted = (rebased['$defs'] as Record<string, Record<string, unknown>>)['A-d']
    expect((hoisted?.['dependencies'] as Record<string, unknown>)['definitions']).toEqual({ type: 'string' })
    expect(issues).toEqual([])
  })

  it('drops the tail when a tailed ref targets something that degrades to {}', () => {
    // `#/$defs/Missing/properties/x` with Missing = {} is a dangling pointer
    // the generators abort on — the degrade contract is one branch's
    // precision, never the build.
    const issues: ExtractionIssue[] = []
    const avroDoc = {
      asyncapi: '3.0.0',
      components: {
        schemas: {
          AvroThing: { schemaFormat: 'application/vnd.apache.avro;version=1.9.0', schema: { type: 'record' } },
          A: { type: 'object', definitions: { real: { type: 'string' } } },
        },
      },
    }
    for (const ref of [
      '#/components/schemas/Missing/properties/x',
      '#/components/schemas/AvroThing/properties/x',
      '#/components/schemas/A/definitions/Nope/properties/y',
    ]) {
      const rebased = rebaseComponentRefs({ $ref: ref }, avroDoc, 'asyncapi', issues, '#/x')
      const target = (rebased['$defs'] as Record<string, unknown>)[(rebased['$ref'] as string).replace('#/$defs/', '')]
      // The rewritten ref must land exactly on its {} target — no tail.
      expect(rebased['$ref'], ref).toMatch(/^#\/\$defs\/[^/]+$/)
      expect(target, ref).toEqual({})
    }
    expect(issues.length).toBe(3)
  })

  it('finds percent-encoded definition names the document declares', () => {
    const issues: ExtractionIssue[] = []
    const spaced = {
      asyncapi: '3.0.0',
      components: {
        schemas: {
          A: { type: 'object', definitions: { 'My Def': { type: 'string' } } },
          B: {
            type: 'object',
            properties: { d: { $ref: '#/definitions/My%20Def' } },
            definitions: { 'My Def': { type: 'string' } },
          },
        },
      },
    }
    // The RFC 6901 URI-fragment spelling of a tail must reach the declared entry...
    const tail = rebaseComponentRefs(
      { $ref: '#/components/schemas/A/definitions/My%20Def' },
      spaced,
      'asyncapi',
      issues,
      '#/x',
    )
    expect((tail['$defs'] as Record<string, unknown>)[(tail['$ref'] as string).replace('#/$defs/', '')]).toEqual({
      type: 'string',
    })
    // ...and so must a component-internal ref spelled the same way.
    const internal = rebaseComponentRefs({ $ref: '#/components/schemas/B' }, spaced, 'asyncapi', issues, '#/x')
    const defs = internal['$defs'] as Record<string, Record<string, unknown>>
    const innerRef = ((defs['B']?.['properties'] as Record<string, Record<string, string>>)['d']?.['$ref'] ??
      '') as string
    expect(defs[innerRef.replace('#/$defs/', '')]).toEqual({ type: 'string' })
    expect(issues).toEqual([])
  })

  it('follows a $defs-spelled ref into a 2020-12 component that only declares definitions', () => {
    const issues: ExtractionIssue[] = []
    const legacy = {
      asyncapi: '3.0.0',
      components: {
        schemas: {
          A: {
            schemaFormat: 'application/schema+json;version=draft-2020-12',
            schema: { type: 'object', definitions: { x: { type: 'integer' } } },
          },
        },
      },
    }
    const rebased = rebaseComponentRefs({ $ref: '#/components/schemas/A/$defs/x' }, legacy, '2020-12', issues, '#/x')
    expect((rebased['$defs'] as Record<string, unknown>)[(rebased['$ref'] as string).replace('#/$defs/', '')]).toEqual({
      type: 'integer',
    })
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
