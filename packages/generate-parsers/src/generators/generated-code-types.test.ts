import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { buildSchema } from './build-schema'

/**
 * The sibling `generated-code-syntax` suite proves the output *parses*; this one
 * proves it *type-checks*. Everything the generator emits is string
 * concatenation, so a type definition and the parser built from it can drift
 * apart — a tuple the parser copies with `[...input]`, a fallback literal that
 * no longer satisfies an intersected property type, a discriminant read before
 * anything narrows it. None of those are syntax errors; they only surface when a
 * consumer compiles the output, which no test used to do.
 *
 * Each schema is generated into its own virtual directory and the whole set is
 * checked in one `strict` program. `helpersMode: 'embedded'` keeps it
 * self-contained, so no module resolution reaches outside the generated files.
 */
const CASES: ReadonlyArray<readonly [string, JSONSchema]> = [
  ['scalars', { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } }, required: ['a'] }],
  ['nullable-scalar', { type: 'object', properties: { a: { type: 'string', nullable: true } }, required: ['a'] }],
  [
    'nullable-object',
    { type: 'object', properties: { a: { type: ['object', 'null'], properties: { b: { type: 'string' } } } } },
  ],
  ['nullable-array', { type: 'object', properties: { a: { type: ['array', 'null'], items: { type: 'string' } } } }],
  ['tuple-closed', { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], items: false }],
  ['tuple-open', { type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'number' }, minItems: 1 }],
  ['tuple-draft07', { type: 'array', items: [{ type: 'string' }, { type: 'number' }], additionalItems: false }],
  [
    'index-signature',
    {
      type: 'object',
      properties: { a: { type: 'string' }, n: { type: 'number' } },
      required: ['n'],
      additionalProperties: { type: 'number' },
    },
  ],
  [
    'pattern-properties',
    { type: 'object', properties: { a: { type: 'string' } }, patternProperties: { '^x-': { type: 'number' } } },
  ],
  [
    'allof-inline',
    {
      type: 'object',
      properties: { a: { type: 'string' } },
      allOf: [{ type: 'object', properties: { b: { type: 'number' } }, required: ['b'] }],
    },
  ],
  [
    'allof-required-object',
    {
      type: 'object',
      required: ['nested'],
      properties: {
        nested: {
          allOf: [
            { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
            { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
          ],
        },
      },
    },
  ],
  [
    'discriminated-union',
    {
      oneOf: [
        { type: 'object', properties: { kind: { const: 'dog' }, bark: { type: 'boolean' } }, required: ['kind'] },
        { type: 'object', properties: { kind: { const: 'cat' }, meow: { type: 'boolean' } }, required: ['kind'] },
      ],
    },
  ],
  [
    'non-identifier-discriminator',
    {
      oneOf: [
        { type: 'object', properties: { 'x-type': { const: 'a' } }, required: ['x-type'] },
        { type: 'object', properties: { 'x-type': { const: 'b' } }, required: ['x-type'] },
      ],
    },
  ],
  [
    'nested-optional-objects',
    {
      type: 'object',
      properties: {
        outer: {
          type: 'object',
          properties: { inner: { type: 'object', properties: { deep: { type: 'string' } } } },
        },
      },
    },
  ],
  [
    'optional-array-of-objects',
    {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } },
      },
    },
  ],
  [
    'mismatched-default',
    {
      type: 'object',
      required: ['xs'],
      properties: { xs: { type: 'array', default: 'nope', items: { type: 'string' } } },
    },
  ],
  [
    'jsdoc-comment-terminator',
    {
      type: 'object',
      description: 'Root matching **/*.ts',
      properties: { include: { type: 'string', description: 'Glob such as **/*.ts to match' } },
    },
  ],
  [
    'refs',
    {
      type: 'object',
      properties: { contact: { $ref: '#/$defs/contact' } },
      $defs: { contact: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] } },
    },
  ],
]

const OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  skipLibCheck: true,
}

/** Joins a relative import specifier onto its importer's directory. */
const resolveVirtualPath = (fromFile: string, specifier: string): string => {
  const segments = fromFile.slice(1).split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  return `/${segments.join('/')}`
}

const typeErrors = (sources: ReadonlyMap<string, string>): string[] => {
  const host = ts.createCompilerHost(OPTIONS)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const getSourceFile = host.getSourceFile.bind(host)

  host.readFile = (fileName) => sources.get(fileName) ?? readFile(fileName)
  host.fileExists = (fileName) => sources.has(fileName) || fileExists(fileName)
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const content = sources.get(fileName)
    return content !== undefined
      ? ts.createSourceFile(fileName, content, languageVersion, true)
      : getSourceFile(fileName, languageVersion, onError, shouldCreate)
  }
  // The files only exist in this map, so the compiler's own (disk-backed)
  // resolution finds nothing — every relative import has to be resolved by hand.
  host.resolveModuleNameLiterals = (moduleLiterals, containingFile) =>
    moduleLiterals.map((literal) => {
      const resolved = resolveVirtualPath(containingFile, literal.text)
      return sources.has(resolved)
        ? { resolvedModule: { resolvedFileName: resolved, extension: ts.Extension.Ts } }
        : { resolvedModule: undefined }
    })

  const program = ts.createProgram([...sources.keys()], OPTIONS, host)
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file !== undefined)
    .map(
      (diagnostic) => `${diagnostic.file?.fileName}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    )
}

describe('generated-code-types', () => {
  it('emits type-correct output for every mode', { timeout: 120000 }, async () => {
    const sources = new Map<string, string>()
    for (const [name, schema] of CASES) {
      for (const [mode, strict, readonly] of [
        ['coerce', false, false],
        ['strict', true, false],
        ['readonly', false, true],
      ] as const) {
        const files = await buildSchema(
          schema,
          'Doc',
          undefined,
          false,
          false,
          strict,
          'embedded',
          './',
          readonly,
          false,
          '',
          'ts',
        )
        for (const file of files) sources.set(`/${name}-${mode}/${file.filename}`, file.content)
      }
    }

    expect(typeErrors(sources)).toEqual([])
  })
})
