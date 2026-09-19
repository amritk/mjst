import { transformSync } from 'esbuild'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { ALL_MODES, type GeneratedFile, generate, type Mode } from './generate'

/**
 * The package's whole claim is that one output directory can carry every mode
 * over *one* type. Two things have to hold for that, and neither is provable by
 * reading the emitted text:
 *
 *   1. it compiles — under this repo's flags, including `noUnusedLocals`, which
 *      is what an import left behind by the types-only pruning would fail; and
 *   2. it runs — every mode a caller asked for is actually exported and actually
 *      does what its name says, across a `$ref` boundary where the type lives in
 *      one file and the parser half in another.
 *
 * So the suite compiles the set and then links and calls it, rather than
 * asserting on substrings.
 */

const schema: JSONSchema = {
  type: 'object',
  properties: {
    n: { type: 'integer', minimum: 0, maximum: 10, default: 3 },
    s: { type: 'string', minLength: 2 },
    r: { $ref: '#/$defs/inner' },
  },
  required: ['n'],
  $defs: { inner: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] } },
}

/** Type-checks a generated set under the repo's own flags, returning the diagnostics. */
const typeErrors = (files: readonly GeneratedFile[]): string[] => {
  const sources = new Map(files.map((file) => [`/${file.filename}`, file.content]))
  const options: ts.CompilerOptions = {
    strict: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    noImplicitReturns: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
  }

  const host = ts.createCompilerHost(options)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  // `./x.js` resolves to the sibling `x.ts` the generator actually wrote.
  const resolve = (name: string): string => (sources.has(name) ? name : name.replace(/\.js$/, '.ts'))

  host.fileExists = (name) => sources.has(resolve(name)) || fileExists(name)
  host.readFile = (name) => sources.get(resolve(name)) ?? readFile(name)
  host.getSourceFile = (name, languageVersion) => {
    const content = sources.get(resolve(name)) ?? readFile(name)
    return content === undefined ? undefined : ts.createSourceFile(name, content, languageVersion, true)
  }
  // Resolved explicitly rather than left to the default lookup: these modules
  // exist only in the map, they sit in a nested `_helpers/` directory, and the
  // specifiers carry the `.js` extension a shipped consumer needs.
  host.resolveModuleNames = (names, containing) =>
    names.map((name) => {
      if (!name.startsWith('.')) return undefined
      const base = containing.slice(0, containing.lastIndexOf('/'))
      const joined: string[] = []
      for (const segment of `${base}/${name}`.split('/')) {
        if (segment === '.' || segment === '') continue
        if (segment === '..') joined.pop()
        else joined.push(segment)
      }
      const resolvedFileName = resolve(`/${joined.join('/')}`)
      return sources.has(resolvedFileName) ? { resolvedFileName, extension: ts.Extension.Ts } : undefined
    })

  const program = ts.createProgram([...sources.keys()], options, host)
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file && sources.has(resolve(diagnostic.file.fileName)))
    .map((diagnostic) => {
      const where = diagnostic.file?.fileName ?? '?'
      return `${where}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`
    })
}

/** Links a generated set in memory and returns one export from its barrel. */
const link = <T>(files: readonly GeneratedFile[], exportName: string): T => {
  const sources = new Map(files.map((file) => [file.filename.replace(/\.ts$/, ''), file.content]))
  const loaded = new Map<string, Record<string, unknown>>()

  const load = (specifier: string): Record<string, unknown> => {
    const key = specifier.replace(/^\.\//, '').replace(/\.js$/, '')
    const cached = loaded.get(key)
    if (cached !== undefined) return cached
    const source = sources.get(key)
    if (source === undefined) throw new Error(`no generated module "${specifier}"`)

    const module = { exports: {} as Record<string, unknown> }
    loaded.set(key, module.exports)
    const js = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
    new Function('module', 'exports', 'require', js)(module, module.exports, load)
    loaded.set(key, module.exports)
    return module.exports
  }

  return load('index')[exportName] as T
}

describe('generate', () => {
  it('emits only the read-only modes by default', async () => {
    const files = await generate(schema, 'Doc')
    const doc = files.find((file) => file.filename === 'doc.ts')?.content ?? ''

    expect(doc).toContain('export const validateDoc')
    expect(doc).toContain('export const isDoc')
    expect(doc).not.toContain('export const coerceDoc')
    expect(doc).not.toContain('export const repairDoc')
    // Nothing that rewrites a document is on by default.
    expect(files.some((file) => file.filename.endsWith('.parse.ts'))).toBe(false)
  })

  it.each([
    ['types only', ['types'] as Mode[]],
    ['guard only', ['types', 'guard'] as Mode[]],
    ['validate only', ['types', 'validate'] as Mode[]],
    ['coerce', ['types', 'validate', 'coerce'] as Mode[]],
    ['repair', ['types', 'validate', 'repair'] as Mode[]],
    ['parse', ['types', 'parse'] as Mode[]],
    ['parse strict', ['types', 'parseStrict'] as Mode[]],
    ['everything', [...ALL_MODES] as Mode[]],
  ])('type-checks the %s output', { timeout: 120_000 }, async (_label, modes) => {
    const files = await generate(schema, 'Doc', { modes, helpersMode: 'embedded' })

    expect(typeErrors(files)).toEqual([])
  })

  it('declares the type exactly once, however many modes are asked for', async () => {
    const files = await generate(schema, 'Doc', { modes: [...ALL_MODES], helpersMode: 'embedded' })

    const declarations = files.flatMap((file) => [...file.content.matchAll(/^export type Doc\b/gm)])

    expect(declarations).toHaveLength(1)
  })

  it('runs every mode from one barrel, over one type', async () => {
    const files = await generate(schema, 'Doc', { modes: [...ALL_MODES], helpersMode: 'embedded' })

    const isDoc = link<(v: unknown) => boolean>(files, 'isDoc')
    const validateDoc = link<(v: unknown) => unknown>(files, 'validateDoc')
    const coerceDoc = link<(v: unknown) => { valid: boolean; value?: unknown }>(files, 'coerceDoc')
    const repairDoc = link<(v: unknown) => { valid: boolean; value: unknown; repairs: unknown[] }>(files, 'repairDoc')
    const parseDoc = link<(v: unknown) => unknown>(files, 'parseDoc')

    // guard — fail fast, no error object
    expect(isDoc({ n: 5 })).toBe(true)
    expect(isDoc({ n: 99 })).toBe(false)

    // validate — every error
    expect(validateDoc({ n: 5 })).toBe(true)
    expect(validateDoc({ n: 99 })).toMatchObject({ valid: false })

    // coerce — a value written in the wrong type is the right value
    expect(coerceDoc({ n: '5' })).toEqual({ valid: true, value: { n: 5 } })
    // …and one that cannot be coerced is still rejected
    expect(coerceDoc({ n: 99 })).toMatchObject({ valid: false })

    // repair — substitutes, and says what it substituted
    const repaired = repairDoc({ n: 99 })
    expect(repaired).toMatchObject({ valid: true, value: { n: 3 } })
    expect(repaired.repairs).toHaveLength(1)

    // parse — total, reports nothing
    expect(parseDoc({ n: 99 })).toEqual({ n: 3 })
  })

  it('repairs and parses to the same document, across a $ref', async () => {
    const files = await generate(schema, 'Doc', { modes: [...ALL_MODES], helpersMode: 'embedded' })

    const repairDoc = link<(v: unknown) => { value: unknown }>(files, 'repairDoc')
    const parseDoc = link<(v: unknown) => unknown>(files, 'parseDoc')
    const input = { n: 99, s: 'a', r: {} }

    // Both halves of the output are talking about the same schema and the same
    // fallback table, so they had better agree — including inside the `$ref`.
    expect(repairDoc(input).value).toEqual(parseDoc(input))
  })

  // One hand-picked schema proves the wiring; it does not prove the text surgery
  // survives the shapes a real document takes. These are the shapes the
  // validators package type-checks its own output against, run through every
  // mode at once — the combination most able to leave an orphaned import behind.
  it.each([
    ['scalar root', { type: 'string', pattern: '^[a-z]+$', minLength: 2 }],
    ['number root', { type: 'number', minimum: 0, exclusiveMaximum: 10, multipleOf: 2 }],
    ['array root', { type: 'array', items: { type: 'string' }, minItems: 1, uniqueItems: true }],
    ['nullable', { type: 'object', properties: { a: { type: ['string', 'null'] } }, required: ['a'] }],
    ['closed object', { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false }],
    ['pattern properties', { type: 'object', patternProperties: { '^x-': { type: 'number' } } }],
    ['additional schema', { type: 'object', additionalProperties: { type: 'integer' } }],
    ['enum', { type: 'object', properties: { e: { enum: ['a', 'b'] } }, required: ['e'] }],
    ['const', { type: 'object', properties: { c: { const: 'fixed' } }, required: ['c'] }],
    ['union', { type: 'object', properties: { u: { anyOf: [{ type: 'string' }, { type: 'number' }] } } }],
    ['tuple', { type: 'object', properties: { t: { type: 'array', prefixItems: [{ type: 'string' }] } } }],
    ['dependent required', { type: 'object', properties: { a: { type: 'string' } }, dependentRequired: { a: ['b'] } }],
    [
      'nested objects',
      { type: 'object', properties: { o: { type: 'object', properties: { b: { type: 'string' } }, required: ['b'] } } },
    ],
    [
      'recursive $ref',
      {
        type: 'object',
        properties: { child: { $ref: '#' } },
        $defs: { unused: { type: 'string' } },
      },
    ],
  ] as ReadonlyArray<readonly [string, JSONSchema]>)(
    'type-checks every mode over a %s schema',
    { timeout: 120_000 },
    async (_label, corpusSchema) => {
      const files = await generate(corpusSchema, 'Doc', { modes: [...ALL_MODES], helpersMode: 'embedded' })

      expect(typeErrors(files)).toEqual([])
    },
  )

  it('throws rather than emitting two contracts for one function name', async () => {
    await expect(generate(schema, 'Doc', { modes: ['parse', 'parseStrict'] })).rejects.toThrow(/Ask for one/)
  })

  it('moves the parser half aside only when the validator half is there to collide with', async () => {
    const together = await generate(schema, 'Doc', { modes: ['types', 'validate', 'parse'], helpersMode: 'embedded' })
    const names = together.map((file) => file.filename)

    // Both generators name their file after the schema, so one gives way — and it
    // is the parser, because a reader opening `doc.ts` should find the type.
    expect(names).toContain('doc.ts')
    expect(names).toContain('doc.parse.ts')
    expect(together.find((file) => file.filename === 'doc.parse.ts')?.content).toContain(
      "import type { Doc } from './doc.js'",
    )
  })

  it('leaves the parser file where it is when nothing collides with it', async () => {
    const alone = await generate(schema, 'Doc', { modes: ['types', 'parse'], helpersMode: 'embedded' })
    const names = alone.map((file) => file.filename)

    // No validator half means no collision, so there is no suffix to resolve one
    // — and the parser keeps the type it already authored.
    expect(names).toContain('doc.ts')
    expect(names).not.toContain('doc.parse.ts')
    expect(alone.find((file) => file.filename === 'doc.ts')?.content).toContain('export type Doc')
  })

  it.each([['js'], ['ts']] as const)('emits %s specifiers consistently across both halves', async (ext) => {
    const files = await generate(schema, 'Doc', {
      modes: [...ALL_MODES],
      helpersMode: 'embedded',
      importExt: ext,
    })

    const specifiers = files.flatMap((file) =>
      [...file.content.matchAll(/from '(\.[^']*)'/g)].map((m) => m[1] as string),
    )

    expect(specifiers.length).toBeGreaterThan(0)
    // One directory, one extension. A set where the parser files say `.ts` and the
    // validator files say `.js` resolves under neither runtime, and that is what
    // hardcoding it on one side of the split would have produced.
    expect(specifiers.filter((specifier) => !specifier.endsWith(`.${ext}`))).toEqual([])
  })

  it('resolves every relative specifier to a file it actually emitted', async () => {
    const files = await generate(schema, 'Doc', { modes: [...ALL_MODES], helpersMode: 'embedded', importExt: 'ts' })
    const emitted = new Set(files.map((file) => file.filename))

    const dangling = files.flatMap((file) => {
      const dir = file.filename.includes('/') ? `${file.filename.slice(0, file.filename.lastIndexOf('/'))}/` : ''
      return [...file.content.matchAll(/from '(\.[^']*)'/g)]
        .map((match) => (match[1] as string).replace(/^\.\//, ''))
        .map((specifier) => {
          const joined: string[] = []
          for (const segment of `${dir}${specifier}`.split('/')) {
            if (segment === '.' || segment === '') continue
            if (segment === '..') joined.pop()
            else joined.push(segment)
          }
          return joined.join('/')
        })
        .filter((target) => !emitted.has(target))
    })

    expect(dangling).toEqual([])
  })

  it('ships no validator runtime for a build that asked for no validator mode', async () => {
    const parseOnly = await generate(schema, 'Doc', { modes: ['types', 'parse'], helpersMode: 'embedded' })
    const typesOnly = await generate(schema, 'Doc', { modes: ['types'], helpersMode: 'embedded' })

    // `validation-result.ts` is 17 KiB of error types and runtime helpers. Nothing
    // in either of these builds can import it, so shipping it is dead weight in
    // the consumer's bundle.
    expect(parseOnly.some((file) => file.filename === 'validation-result.ts')).toBe(false)
    expect(typesOnly.some((file) => file.filename === 'validation-result.ts')).toBe(false)
    // …and it is still there the moment something needs it.
    const withValidate = await generate(schema, 'Doc', { modes: ['types', 'validate'], helpersMode: 'embedded' })
    expect(withValidate.some((file) => file.filename === 'validation-result.ts')).toBe(true)
  })
})
