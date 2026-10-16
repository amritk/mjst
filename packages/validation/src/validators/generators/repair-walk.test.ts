import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { buildValidatorSchema } from './build-schema'
import { linkGenerated } from './link-generated.test-utils'
import { OPENAPI_COERCER_SCHEMA } from './openapi-coercer-schema.test-utils'

/**
 * The single-pass repair walk, exercised through the linked output.
 *
 * The invariant most of these are instances of: whatever `repairX` hands back
 * with `valid: true` is a value `validateX` accepts, and a valid document comes
 * back as itself, untouched.
 */

type ValidationError = { message: string; path: string; keyword: string; params: Record<string, unknown> }
type RepairResult = { valid: boolean; value: unknown; repairs: ValidationError[]; errors?: ValidationError[] }
type Repair = (input: unknown, options?: Record<string, unknown> | string) => RepairResult
type Validate = (input: unknown) => true | { valid: false; errors: ValidationError[] }
type Lookup = (segments: readonly string[], index: number, value: unknown) => unknown
/** A document the tests break and read back at arbitrary depth. */
// biome-ignore lint/suspicious/noExplicitAny: the documents are mutated and read at arbitrary depth
type Json = any

type Built = {
  repair: Repair
  validate: Validate
  lookup: Lookup
  files: readonly { filename: string; content: string }[]
}

const build = async (schema: JSONSchema, name = 'Root'): Promise<Built> => {
  const files = await buildValidatorSchema(schema, name, '', undefined, 'count-keys', undefined, false, false, true)
  return {
    repair: linkGenerated<Repair>(files, 'index', `repair${name}`),
    validate: linkGenerated<Validate>(files, 'index', `validate${name}`),
    lookup: linkGenerated<Lookup>(files, 'index', `repair${name}At`),
    files,
  }
}

/** A small, valid document for {@link OPENAPI_COERCER_SCHEMA}. */
const petstore = (): Record<string, unknown> => ({
  openapi: '3.1.0',
  info: { title: 'Petstore', version: '1.0.0', license: { name: 'MIT' } },
  paths: {
    '/pets/{id}': {
      parameters: [{ $ref: '#/components/parameters/id' }],
      get: {
        operationId: 'getPet',
        parameters: [{ name: 'verbose', in: 'query', schema: { type: 'boolean' } }],
        responses: {
          '200': {
            description: 'A pet',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
          default: { $ref: '#/components/responses/Error' },
        },
      },
    },
  },
  components: {
    parameters: { id: { name: 'id', in: 'path', required: true, schema: { type: 'string' } } },
    responses: { Error: { description: 'An error' } },
    schemas: {
      Pet: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' }, owner: { $ref: '#/components/schemas/Owner' } },
      },
      Owner: { type: 'object', properties: { pets: { type: 'array', items: { $ref: '#/components/schemas/Pet' } } } },
    },
    securitySchemes: { key: { type: 'apiKey', name: 'X-Key', in: 'header' } },
  },
})

const openapi = build(OPENAPI_COERCER_SCHEMA, 'OpenApi')

describe('the repair walk', () => {
  it('is what repairX runs for a schema it covers', async () => {
    const { files } = await openapi
    const root = files.find((file) => file.filename === 'openapi.ts')?.content ?? ''
    expect(root).toContain('runRepairWalk<OpenApi>(input, options, walkOpenApiRepair)')
    expect(root).not.toContain('runRepairLoop')
  })

  it('keeps the loop for a schema with a keyword the walk does not repair', async () => {
    const { files } = await build({ type: 'array', items: { type: 'string' }, minItems: 2 })
    const root = files.find((file) => file.filename === 'root.ts')?.content ?? ''
    expect(root).toContain('runRepairLoop<Root>(')
    expect(root).not.toContain('runRepairWalk')
  })

  it('hands a valid document back as itself, in place or not', async () => {
    const { repair } = await openapi
    const doc = petstore()
    const before = structuredClone(doc)

    const inPlace = repair(doc, { inPlace: true })
    expect(inPlace).toEqual({ valid: true, value: doc, repairs: [] })
    expect(inPlace.value).toBe(doc)

    const copied = repair(doc)
    expect(copied.value).toBe(doc)
    expect(doc).toEqual(before)
  })

  it('repairs wrong-typed and missing values at any if/then/else depth in one call', async () => {
    const { repair, validate } = await openapi
    const doc = petstore() as Json
    doc.info.title = 7
    doc.paths['/pets/{id}'].get.parameters[0].schema.type = 5
    doc.paths['/pets/{id}'].get.responses['200'].description = ['no']
    delete doc.components.responses.Error.description
    doc.components.schemas.Pet.properties.owner = 'not a schema'

    const result = repair(doc, { coerce: false })

    expect(result.valid).toBe(true)
    expect(validate(result.value)).toBe(true)
    const value = result.value as Json
    expect(value.info.title).toBe('')
    expect(value.paths['/pets/{id}'].get.parameters[0].schema.type).toBe('')
    expect(value.paths['/pets/{id}'].get.responses['200'].description).toBe('')
    expect(value.components.responses.Error.description).toBe('')
    expect(value.components.schemas.Pet.properties.owner).toEqual({})
    expect(result.repairs.map((error) => `${error.keyword} ${error.path}`)).toEqual([
      'type /info/title',
      'type /paths/~1pets~1{id}/get/parameters/0/schema/type',
      'type /paths/~1pets~1{id}/get/responses/200/description',
      'type /components/schemas/Pet/properties/owner',
      'required /components/responses/Error',
    ])
  })

  it('evaluates each if against the value at that point, after its own repairs', async () => {
    const { repair } = await openapi
    const doc = petstore() as Json
    // A path parameter must say `required: true` — a then-branch on a
    // discriminator. One missing it, one with a wrong discriminator, one wrong.
    doc.paths['/pets/{id}'].get.parameters = [
      { name: 'a', in: 'path' },
      { name: 'b', in: 'nowhere' },
      { name: 'c', in: 'path', required: 'yes' },
    ]

    const result = repair(doc, { coerce: false })

    expect(result.valid).toBe(true)
    expect((result.value as Json).paths['/pets/{id}'].get.parameters).toEqual([
      { name: 'a', in: 'path', required: true },
      { name: 'b', in: 'query' },
      { name: 'c', in: 'path', required: true },
    ])
  })

  it('builds a missing required object with its required children in one step', async () => {
    const { repair } = await openapi
    const doc = petstore() as Json
    delete doc.info
    doc.components.securitySchemes.key = { type: 'oauth2' }

    const result = repair(doc)

    expect(result.valid).toBe(true)
    const value = result.value as Json
    expect(value.info).toEqual({ title: '', version: '1.0.0' })
    // The discriminator picks the branch, and the branch's own requirements
    // arrive with the repair.
    expect(value.components.securitySchemes.key).toEqual({ type: 'oauth2', flows: {} })
    expect(result.repairs.map((error) => error.keyword)).toEqual(['required', 'required'])
  })

  it('builds a recursive requirement to a bounded depth instead of forever', async () => {
    const { repair } = await build({
      $defs: { node: { type: 'object', required: ['child'], properties: { child: { $ref: '#/$defs/node' } } } },
      type: 'object',
      required: ['root'],
      properties: { root: { $ref: '#/$defs/node' } },
    })

    const result = repair({})

    let depth = 0
    let node = (result.value as Json).root
    while (node?.child !== undefined) {
      node = node.child
      depth++
    }
    expect(depth).toBeGreaterThan(4)
    expect(depth).toBeLessThan(40)
    // The schema has no finite instance, and the result says so.
    expect(result.valid).toBe(false)
  })

  it('removes a drop-marked position instead of defaulting it', async () => {
    const { repair, validate } = await openapi
    const doc = petstore() as Json
    doc.externalDocs = 'https://example.com'
    doc.paths['/pets/{id}'].get.parameters[0].allowEmptyValue = 'sometimes'

    const result = repair(doc, { coerce: false })

    expect(result.valid).toBe(true)
    expect(validate(result.value)).toBe(true)
    expect(result.value).not.toHaveProperty('externalDocs')
    expect((result.value as Json).paths['/pets/{id}'].get.parameters[0]).not.toHaveProperty('allowEmptyValue')
    expect(result.repairs.map((error) => `${error.keyword} ${error.path}`)).toEqual([
      'type /paths/~1pets~1{id}/get/parameters/0/allowEmptyValue',
      'type /externalDocs',
    ])
  })

  it('removes what a false schema forbids: properties, closed-object keys and array elements', async () => {
    const { repair, validate } = await build({
      type: 'object',
      properties: {
        gone: false,
        closed: { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false },
        list: { type: 'array', items: { if: { type: 'string' }, then: true, else: false } },
      },
    })
    const input = { gone: 1, closed: { a: 'x', b: 2, c: 3 }, list: ['a', 1, 'b', 2, 3, 'c'] }

    const result = repair(input)

    expect(result.valid).toBe(true)
    expect(validate(result.value)).toBe(true)
    expect(result.value).toEqual({ closed: { a: 'x' }, list: ['a', 'b', 'c'] })
    // Each removal is reported at the index the document had.
    expect(result.repairs.map((error) => `${error.keyword} ${error.path}`)).toEqual([
      'false schema /gone',
      'additionalProperties /closed/b',
      'additionalProperties /closed/c',
      'false schema /list/1',
      'false schema /list/3',
      'false schema /list/4',
    ])
    expect(input).toEqual({ gone: 1, closed: { a: 'x', b: 2, c: 3 }, list: ['a', 1, 'b', 2, 3, 'c'] })
  })

  it('assigns and deletes on the input in place, and copies only the touched path otherwise', async () => {
    const { repair } = await openapi
    const doc = petstore() as Json
    doc.info.title = 1
    doc.externalDocs = 5
    const paths = doc.paths

    const copied = repair(doc)
    const value = copied.value as Json
    expect(value).not.toBe(doc)
    expect(value.paths).toBe(paths)
    expect(doc.info.title).toBe(1)
    expect(doc.externalDocs).toBe(5)

    const inPlace = repair(doc, { inPlace: true })
    expect(inPlace.value).toBe(doc)
    expect(doc.info.title).toBe('1')
    expect(doc).not.toHaveProperty('externalDocs')
  })

  it('coerces a scalar written in the wrong type only when asked to', async () => {
    const { repair } = await build({
      type: 'object',
      properties: { n: { type: 'integer', default: 1 }, b: { type: 'boolean' } },
    })

    const coerced = repair({ n: '5', b: 'true' })
    expect(coerced).toEqual({ valid: true, value: { n: 5, b: true }, repairs: [] })

    const repaired = repair({ n: '5', b: 'true' }, { coerce: false })
    expect(repaired.value).toEqual({ n: 1, b: false })
    expect(repaired.repairs.map((error) => `${error.keyword} ${error.path}`)).toEqual(['type /n', 'type /b'])
  })
})

describe('instance $ref following', () => {
  it('validates and repairs a target under the type of the position that named it', async () => {
    const { repair } = await openapi
    const doc = petstore() as Json
    doc['x-shared'] = { size: { name: 5, in: 'query' } }
    doc.paths['/pets/{id}'].get.parameters.push({ $ref: '#/x-shared/size' })

    const result = repair(doc, { inPlace: true })

    expect(result.valid).toBe(true)
    // Repaired where it lives, and reported there.
    expect(doc['x-shared'].size.name).toBe('5')
    expect(result.repairs).toEqual([])

    doc['x-shared'].size = { in: 'query' }
    const missing = repair(doc, { inPlace: true })
    expect(missing.repairs.map((error) => `${error.keyword} ${error.path}`)).toEqual(['required /x-shared/size'])
    expect(doc['x-shared'].size).toEqual({ in: 'query', name: '' })
  })

  it('reports a target that does not resolve, and never creates it', async () => {
    const { repair } = await openapi
    const doc = petstore() as Json
    doc.paths['/pets/{id}'].get.parameters.push({ $ref: '#/components/parameters/missing' })

    const result = repair(doc)

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([
      {
        message: "can't resolve reference #/components/parameters/missing",
        path: '/paths/~1pets~1{id}/get/parameters/1/$ref',
        keyword: 'unresolvedRef',
        params: { ref: '#/components/parameters/missing' },
      },
    ])
    expect((result.value as Json).components.parameters).not.toHaveProperty('missing')
  })

  it('resolves escaped and percent-encoded pointers through own properties only', async () => {
    const { repair } = await openapi
    const doc = petstore() as Json
    doc['x-odd'] = { 'a/b': { '~c': { 'd e': { name: 'n', in: 'query' } } } }
    doc.paths['/pets/{id}'].get.parameters.push({ $ref: '#/x-odd/a~1b/~0c/d%20e' })
    doc.paths['/pets/{id}'].get.parameters.push({ $ref: '#/x-odd/constructor' })
    doc.paths['/pets/{id}'].get.parameters.push({ $ref: '#/x-odd/__proto__' })

    const result = repair(doc)

    expect(result.errors?.map((error) => error.params['ref'])).toEqual(['#/x-odd/constructor', '#/x-odd/__proto__'])
  })

  it('follows chains and survives cycles between references', async () => {
    const { repair } = await openapi
    const doc = petstore() as Json
    doc['x-a'] = { $ref: '#/x-b' }
    doc['x-b'] = { $ref: '#/x-c' }
    doc['x-c'] = { name: 1, in: 'cookie' }
    doc['x-loop1'] = { $ref: '#/x-loop2' }
    doc['x-loop2'] = { $ref: '#/x-loop1' }
    doc.paths['/pets/{id}'].get.parameters.push({ $ref: '#/x-a' }, { $ref: '#/x-loop1' })

    const result = repair(doc, { inPlace: true })

    expect(result.valid).toBe(true)
    expect(doc['x-c']).toEqual({ name: '1', in: 'cookie' })
  })

  it('walks a target once per type, however many positions name it', async () => {
    const { repair } = await openapi
    const doc = petstore() as Json
    doc['x-shared'] = { name: 5, in: 'query' }
    const parameters = doc.paths['/pets/{id}'].get.parameters
    for (let i = 0; i < 50; i++) parameters.push({ $ref: '#/x-shared' })
    const seen: string[] = []

    const result = repair(doc, {
      coerce: false,
      onRef: (value: Record<string, unknown>, path: string) => {
        if (value['$ref'] === '#/x-shared') seen.push(path)
      },
    })

    expect(result.repairs).toHaveLength(1)
    expect(seen).toHaveLength(50)
  })

  it('skips the targets the root schema already covers, but still resolves them', async () => {
    const { repair } = await openapi
    const doc = petstore() as Json
    const visited: string[] = []
    doc.paths['/pets/{id}'].get.parameters.push({ $ref: '#/components/parameters/nope' })

    const result = repair(doc, {
      skipRefs: ['#/components/'],
      onRef: (value: Record<string, unknown>, path: string, typeId: string) => {
        visited.push(`${typeId} ${path} ${String(value['$ref'])}`)
      },
    })

    expect(result.errors?.map((error) => error.keyword)).toEqual(['unresolvedRef'])
    expect(visited).toContainEqual(
      expect.stringMatching(
        /^Reference\|Parameter#[0-9a-f]{8} \/paths\/~1pets~1\{id\}\/parameters\/0 #\/components\/parameters\/id$/,
      ),
    )
  })

  it('leaves a $ref alone when onRef says so, or when refs are off', async () => {
    const { repair } = await openapi
    const doc = petstore() as Json
    doc.paths['/pets/{id}'].get.parameters.push({ $ref: '#/nowhere' })

    expect(repair(doc, { onRef: () => false }).valid).toBe(true)
    expect(repair(doc, { refs: false }).valid).toBe(true)
    expect(repair(doc).valid).toBe(false)
  })

  it('refuses to generate an opted-in Reference schema the walk cannot serve', async () => {
    await expect(
      build({
        $defs: { ref: { 'x-repair': 'ref', type: 'object', required: ['$ref'] } },
        type: 'array',
        minItems: 1,
        items: { if: { required: ['$ref'] }, then: { $ref: '#/$defs/ref' } },
      }),
    ).rejects.toThrow(/"x-repair": "ref" needs the single-pass repair walk.*minItems/)
  })
})

describe('the walk under hostile input', () => {
  it('collects a very large error list without overflowing the stack', async () => {
    const { repair, validate } = await build({
      $defs: { item: { type: 'object', properties: { n: { type: 'number' } } } },
      type: 'object',
      properties: { items: { type: 'array', items: { $ref: '#/$defs/item' } } },
    })
    const items = Array.from({ length: 200_000 }, () => ({ n: 'x' }))

    const validated = validate({ items })
    expect(validated !== true && validated.errors.length).toBe(200_000)

    const result = repair({ items }, { coerce: false, inPlace: true })
    expect(result.valid).toBe(true)
    expect(result.repairs).toHaveLength(200_000)
  })

  it('reports a position past maxDepth instead of descending into it', async () => {
    const { repair } = await build({
      $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } } },
      $ref: '#/$defs/node',
    })
    let deep: Record<string, unknown> = {}
    for (let i = 0; i < 100; i++) deep = { next: deep }

    const result = repair(deep, { maxDepth: 10 })

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([expect.objectContaining({ keyword: 'maxDepth', path: '/next'.repeat(11) })])
  })

  it('stops at maxWork, and walks a cyclic graph once per schema under memo', async () => {
    const { repair } = await build({
      $defs: { node: { type: 'object', properties: { a: { $ref: '#/$defs/node' }, b: { $ref: '#/$defs/node' } } } },
      $ref: '#/$defs/node',
    })
    const cyclic: Record<string, unknown> = {}
    cyclic['a'] = cyclic
    cyclic['b'] = cyclic

    const budget = repair(cyclic, { maxWork: 100 })
    expect(budget.errors).toEqual([expect.objectContaining({ keyword: 'maxWork' })])

    expect(repair(cyclic, { memo: true })).toEqual({ valid: true, value: cyclic, repairs: [] })
  })

  it('rejects non-finite numbers under finite', async () => {
    const { repair } = await build({ type: 'object', properties: { n: { type: 'number', default: 0 } } })

    expect(repair({ n: Number.NaN }).valid).toBe(true)
    const result = repair({ n: Number.POSITIVE_INFINITY }, { finite: true })
    expect(result.value).toEqual({ n: 0 })
    expect(result.repairs).toEqual([expect.objectContaining({ keyword: 'type', path: '/n' })])
  })

  it('accepts only plain objects, without an own __proto__, under plainObjects', async () => {
    const { repair } = await build({
      type: 'object',
      properties: { o: { type: 'object', properties: { a: { type: 'string' } } } },
    })
    const parsed = JSON.parse('{"o":{"a":"x","__proto__":{"polluted":true}}}')
    class Box {
      a = 'x'
    }

    const result = repair(parsed, { plainObjects: true })
    const value = result.value as Json
    expect(Object.hasOwn(value.o, '__proto__')).toBe(false)
    expect(value.o).toEqual({ a: 'x' })
    expect(result.repairs).toEqual([expect.objectContaining({ keyword: 'plainObject', path: '/o/__proto__' })])

    const boxed = repair({ o: new Box() }, { plainObjects: true })
    expect(boxed.repairs).toEqual([expect.objectContaining({ keyword: 'type', path: '/o' })])
    expect(repair({ o: new Box() }).repairs).toEqual([])
  })
})

describe('repairXAt', () => {
  it('descends through if/then/else, answering from the branch the instance takes', async () => {
    const { lookup } = await openapi
    const doc = petstore() as Json
    const thunk = (answer: unknown): unknown => (typeof answer === 'function' ? answer(0) : answer)

    // `/paths/~1pets~1{id}/parameters/0` is a Reference: its `$ref` repairs to a string.
    expect(thunk(lookup(['paths', '/pets/{id}', 'parameters', '0', '$ref'], 0, doc))).toBe('')
    // The same position holding a Parameter answers from the Parameter branch.
    expect(thunk(lookup(['paths', '/pets/{id}', 'get', 'parameters', '0', 'in'], 0, doc))).toBe('query')
    // A missing object is built whole.
    expect(thunk(lookup(['components', 'securitySchemes', 'new'], 0, doc))).toEqual({
      type: 'apiKey',
      name: '',
      in: 'query',
    })
  })

  it('drives the loop through if/then/else, removals and in-place writes too', async () => {
    // `propertyNames: true` keeps this schema on the loop.
    const { repair, validate } = await build({
      type: 'object',
      propertyNames: true,
      properties: {
        list: {
          type: 'array',
          items: {
            if: { type: 'object', required: ['kind'] },
            then: {
              type: 'object',
              properties: { kind: { enum: ['a'] }, n: { type: 'integer', default: 1 } },
              required: ['n'],
            },
            else: { 'x-repair': 'drop', type: 'string' },
          },
        },
      },
    })
    const input = { list: [{ kind: 'a', n: 'x' }, 5, { kind: 'a' }, 6, 'ok'] }

    const result = repair(input, { inPlace: true, coerce: false })

    expect(result.valid).toBe(true)
    expect(validate(result.value)).toBe(true)
    expect(result.value).toBe(input)
    expect(input).toEqual({ list: [{ kind: 'a', n: 1 }, { kind: 'a', n: 1 }, 'ok'] })
  })
})

describe('the walk against validateX', () => {
  /** Every position in a document, as segments, the root included. */
  const positions = (value: unknown, at: string[] = []): string[][] => {
    const out = [at]
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) out.push(...positions(value[index], [...at, String(index)]))
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, item] of Object.entries(value)) out.push(...positions(item, [...at, key]))
    }
    return out
  }

  /** The document with one position replaced, or removed when `replacement` is `undefined`. */
  const mutate = (doc: unknown, at: readonly string[], replacement: unknown): unknown => {
    const copy = structuredClone(doc)
    if (at.length === 0) return replacement
    let parent = copy as Record<string, unknown>
    for (const segment of at.slice(0, -1)) parent = parent[segment] as Record<string, unknown>
    const last = at.at(-1) as string
    if (replacement === undefined) {
      if (Array.isArray(parent)) parent.splice(Number(last), 1)
      else delete parent[last]
    } else parent[last] = replacement
    return copy
  }

  const reported = (errors: readonly ValidationError[]): string[] =>
    errors.map((error) => `${error.keyword} ${error.path}`).sort()

  it('reports what validateX reports, for every single-position fault', async () => {
    const { repair, validate } = await openapi
    const doc = petstore()
    const replacements: unknown[] = [undefined, 42, 'text', true, null, {}, [], [1]]
    let compared = 0

    for (const at of positions(doc)) {
      for (const replacement of replacements) {
        const input = mutate(doc, at, replacement)
        const validated = validate(input)
        // Instance references are the walk's own addition; validateX never follows one.
        const result = repair(structuredClone(input), { coerce: false, refs: false })

        if (validated === true) {
          expect(result.repairs).toEqual([])
          expect(result.valid).toBe(true)
          continue
        }
        compared++
        // Every error validateX reports, the walk reports too. It can report
        // more, but only under a position validateX reported: filling a missing
        // discriminator picks a branch, and that branch's own requirements are
        // filled in the same call — which a validator judging the original
        // document cannot see.
        const walked = reported([...result.repairs, ...(result.errors ?? [])])
        const expected = reported(validated.errors)
        const extra = [...walked]
        for (const error of expected) {
          const index = extra.indexOf(error)
          expect(index, `${error} at ${at.join('/')} <- ${JSON.stringify(replacement)}`).not.toBe(-1)
          extra.splice(index, 1)
        }
        for (const error of extra) {
          const path = error.slice(error.indexOf(' ') + 1)
          expect(validated.errors.some((cause) => path.startsWith(cause.path))).toBe(true)
        }
        if (result.valid) expect(validate(result.value)).toBe(true)
      }
    }
    expect(compared).toBeGreaterThan(200)
  })

  it('only ever calls a document valid that validateX accepts', async () => {
    const { repair, validate } = await openapi
    const doc = petstore()
    const all = positions(doc)
    const replacements: unknown[] = [undefined, 0, '', false, null, {}, [], { $ref: '#/components/schemas/Pet' }]
    // A fixed-seed generator, so a failure reproduces.
    let seed = 7
    const next = (limit: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % limit
    }

    for (let round = 0; round < 300; round++) {
      let input: unknown = doc
      for (let faults = 0; faults < 4; faults++) {
        const live = positions(input)
        const at = live[next(live.length)] ?? all[0] ?? []
        input = mutate(input, at, replacements[next(replacements.length)])
      }
      for (const options of [{}, { coerce: false }, { inPlace: true }]) {
        const result = repair(structuredClone(input), options)
        if (result.valid) expect(validate(result.value)).toBe(true)
        else expect(result.errors?.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('review regressions', () => {
  it('fills a key a branch requires from the declaration its parent makes', async () => {
    const declared = { kind: { type: 'string', default: 'a' }, mode: { type: 'string' } } as const
    const viaAllOf = await build({ type: 'object', properties: declared, allOf: [{ required: ['kind'] }] })
    expect(viaAllOf.repair({})).toMatchObject({ valid: true, value: { kind: 'a' } })

    const viaThen = await build({
      type: 'object',
      properties: declared,
      if: { properties: { mode: { const: 'x' } }, required: ['mode'] },
      then: { required: ['kind'] },
    })
    expect(viaThen.repair({ mode: 'x' })).toMatchObject({ valid: true, value: { mode: 'x', kind: 'a' } })
  })

  it('repairs toward the branch the instance takes before the parent declaration, in the loop too', async () => {
    // `propertyNames: true` keeps this on the loop.
    const { repair } = await build({
      type: 'object',
      propertyNames: true,
      properties: { in: { type: 'string' }, required: { type: 'boolean' } },
      allOf: [
        {
          if: { properties: { in: { const: 'path' } }, required: ['in'] },
          then: { properties: { required: { const: true } }, required: ['required'] },
        },
      ],
    })

    expect(repair({ in: 'path' })).toMatchObject({ valid: true, value: { in: 'path', required: true } })
  })

  it('leaves a $ref onRef declined alone when it checks the result of another repair', async () => {
    const { repair } = await openapi
    const doc = petstore() as Json
    doc['x-store'] = { name: 3, in: 'query' }
    doc.paths['/pets/{id}'].get.parameters.push({ $ref: '#/x-store' })
    doc.info.title = 1

    const result = repair(doc, {
      coerce: false,
      onRef: (value: Record<string, unknown>) => value['$ref'] !== '#/x-store',
    })

    expect(result.valid).toBe(true)
    expect(doc['x-store'].name).toBe(3)
  })

  it('bounds a fill that requires several copies of itself', async () => {
    const { repair } = await build({
      $defs: {
        node: {
          type: 'object',
          required: ['a', 'b', 'c'],
          properties: { a: { $ref: '#/$defs/node' }, b: { $ref: '#/$defs/node' }, c: { $ref: '#/$defs/node' } },
        },
      },
      type: 'object',
      required: ['n'],
      properties: { n: { $ref: '#/$defs/node' } },
    })

    const started = performance.now()
    const result = repair({})
    expect(performance.now() - started).toBeLessThan(2000)
    expect(result.valid).toBe(false)
  })

  it('repairs the input itself in the loop when coercion copies it first', async () => {
    const { repair } = await build({
      type: 'object',
      propertyNames: true,
      required: ['a'],
      properties: { a: { type: 'string', default: 'x' }, n: { type: 'integer' } },
    })
    const doc = { n: '5' }

    const result = repair(doc, { inPlace: true })

    expect(result.value).toBe(doc)
    expect(doc).toEqual({ n: 5, a: 'x' })
  })

  it('refuses the walk-only options in the loop rather than ignoring them', async () => {
    const { repair } = await build({ type: 'array', items: { type: 'string' }, minItems: 1 })

    expect(() => repair(['a'], { plainObjects: true })).toThrow(/'plainObjects' needs the single-pass repair walk/)
    expect(() => repair(['a'], { maxWork: 10 })).toThrow(/'maxWork'/)
    expect(repair(['a'], { inPlace: true, coerce: false, path: '' }).valid).toBe(true)
  })

  it('refuses a definition named after a type the repairing half imports', async () => {
    await expect(
      build({
        type: 'object',
        properties: { r: { $ref: '#/$defs/RepairRun' } },
        $defs: { RepairRun: { type: 'string' } },
      }),
    ).rejects.toThrow(/"RepairRun", which every generated file already imports/)
  })

  it('walks a target under each position that differs, not only the first with the same branches', async () => {
    const reference = { $ref: '#/$defs/ref' }
    const { repair } = await build({
      $defs: {
        ref: { 'x-repair': 'ref', type: 'object', required: ['$ref'], properties: { $ref: { type: 'string' } } },
        item: { type: 'object', properties: { name: { type: 'string' } } },
      },
      type: 'object',
      properties: {
        loose: { if: { required: ['$ref'] }, then: reference, else: { $ref: '#/$defs/item' } },
        strict: { if: { required: ['$ref'] }, then: reference, else: { $ref: '#/$defs/item' }, required: ['$ref'] },
        store: { type: 'object' },
      },
    } as JSONSchema)
    const doc = { loose: { $ref: '#/store/x' }, strict: { $ref: '#/store/x' }, store: { x: { name: 1 } } }

    const result = repair(doc, { coerce: false })

    // `strict` requires a `$ref`, and the target has none.
    expect(result.errors?.map((error) => `${error.keyword} ${error.path}`)).toContain('required /store/x')
  })

  it('does not read an opt-in out of an example', async () => {
    await expect(
      build({ type: 'array', minItems: 1, items: { type: 'object', examples: [{ 'x-repair': 'ref' }] } } as JSONSchema),
    ).resolves.toBeDefined()
  })
})
