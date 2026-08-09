import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { buildValidatorSchema } from './build-schema'

/**
 * The sibling `generated-code-syntax` suite proves the output *parses*; this one
 * proves it *type-checks* — under the flags this repo actually holds itself to,
 * not a bare `strict`.
 *
 * The package had no equivalent suite at all, which is a real gap: every line the
 * generator emits is string concatenation, so the type definition and the
 * validator built from it can drift apart (a property accessor that no longer
 * type-checks against `Record<string, unknown>`, a guard narrowing that stops
 * being legal, a runtime helper referenced without an import). None of those are
 * syntax errors — they only surface when a consumer compiles the output.
 *
 * Every case is generated into its own virtual directory and the whole set is
 * checked in one `ts.Program`: spinning one up loads the default lib files from
 * disk, and doing that per case is what makes compile suites slow.
 */
const CASES: ReadonlyArray<readonly [string, JSONSchema]> = [
  ['scalars', { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } }, required: ['a'] }],
  ['nullable', { type: 'object', properties: { a: { type: ['string', 'null'] } }, required: ['a'] }],
  ['openapi-nullable', { type: 'object', properties: { a: { type: 'string', nullable: true } } }],
  ['nested-object', { type: 'object', properties: { o: { type: 'object', properties: { b: { type: 'string' } } } } }],
  ['strict-keys', { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false }],
  ['pattern-properties', { type: 'object', patternProperties: { '^x-': { type: 'number' } } }],
  ['additional-properties-schema', { type: 'object', additionalProperties: { type: 'integer' } }],
  ['property-names', { type: 'object', propertyNames: { pattern: '^[a-z]+$', maxLength: 8 } }],
  ['dependent-required', { type: 'object', properties: { a: { type: 'string' } }, dependentRequired: { a: ['b'] } }],
  [
    'dependent-schemas',
    { type: 'object', properties: { a: { type: 'string' } }, dependentSchemas: { a: { required: ['b'] } } },
  ],
  ['min-max-properties', { type: 'object', minProperties: 1, maxProperties: 4 }],
  ['scalar-root', { type: 'string', pattern: '^[a-z]+$', minLength: 2, maxLength: 8 }],
  ['number-root', { type: 'number', minimum: 0, exclusiveMaximum: 10, multipleOf: 2 }],
  ['array-root', { type: 'array', items: { type: 'string' }, minItems: 1, uniqueItems: true }],
  ['array-of-objects', { type: 'array', items: { type: 'object', properties: { a: { type: 'number' } } } }],
  // `uniqueItems` over non-scalar items and a structural `const` are the two
  // shapes that reach for the `valuesEqual` / `allUnique` runtime helpers, so
  // they prove the conditional import in generate-files actually lands.
  ['structural-unique-items', { type: 'array', uniqueItems: true, items: { type: 'object' } }],
  ['structural-const', { type: 'object', properties: { meta: { const: { a: 1, b: [2, 3] } } } }],
  ['enum-with-object-members', { enum: [{ a: 1 }, ['b'], 'c', null] }],
  ['enum-property', { type: 'object', properties: { e: { enum: ['a', 'b'] } }, required: ['e'] }],
  ['tuple-closed', { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], items: false }],
  ['tuple-open', { type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'number' }, minItems: 1 }],
  ['contains', { type: 'array', contains: { type: 'number' }, minContains: 1, maxContains: 3 }],
  ['combinators', { anyOf: [{ type: 'string' }, { type: 'number' }], not: { const: 'x' } }],
  ['one-of', { oneOf: [{ type: 'string' }, { type: 'number' }] }],
  [
    'if-then-else',
    {
      type: 'object',
      properties: { kind: { enum: ['a', 'b'] }, value: { type: 'integer' } },
      if: { properties: { kind: { const: 'a' } }, required: ['kind'] },
      then: { required: ['value'] },
      else: { required: ['kind'] },
    },
  ],
  [
    'refs',
    {
      type: 'object',
      properties: { contact: { $ref: '#/$defs/contact' } },
      required: ['contact'],
      $defs: { contact: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] } },
    },
  ],
  ['quoted-keys', { type: 'object', properties: { 'x-linkedin': { type: 'string' }, "it's": { type: 'number' } } }],
  // Property names that collide with `Object.prototype` members: these read
  // through an own-property guard rather than a plain accessor, and TypeScript
  // has its own opinions about a member called `constructor` or `toString`.
  [
    'prototype-member-properties',
    {
      type: 'object',
      properties: { constructor: { type: 'string' }, toString: { type: 'string' }, ok: { type: 'string' } },
      required: ['toString'],
    },
  ],
  // The `unevaluated*` output is the densest expression the generator emits — a
  // `.every` arrow over a cast accessor, branch conditions bound to locals, and a
  // match IIFE nested inside — so it is exactly the shape most likely to stop
  // compiling under `noUncheckedIndexedAccess` and friends.
  [
    'unevaluated-properties',
    {
      properties: { foo: { type: 'string' } },
      patternProperties: { '^x-': { type: 'number' } },
      allOf: [{ properties: { bar: { type: 'boolean' } } }],
      anyOf: [{ required: ['baz'], properties: { baz: { type: 'string' } } }],
      dependentSchemas: { foo: { properties: { dep: { type: 'string' } } } },
      unevaluatedProperties: { type: 'string' },
    },
  ],
  [
    'unevaluated-items',
    {
      prefixItems: [{ type: 'string' }],
      contains: { type: 'number' },
      if: { minItems: 2 },
      then: { allOf: [{ prefixItems: [true, true] }] },
      unevaluatedItems: false,
    },
  ],
  [
    'unevaluated-through-ref',
    {
      $ref: '#/$defs/base',
      properties: { own: { type: 'string' } },
      unevaluatedProperties: false,
      $defs: { base: { properties: { inherited: { type: 'string' } } } },
    },
  ],
  // A nested object with a *constrained* leaf: the guard's member access reads
  // through a cast (`(obj.a as Record<string, unknown>).b`), and TypeScript will
  // not carry a `typeof` narrowing across two spellings of the same cast — so
  // `…b.length >= 2` came out as `Object is of type 'unknown'` and the emitted
  // file did not compile. Every earlier nested case had a bare-typed leaf, which
  // needs no narrowing, so nothing here noticed.
  [
    'nested-object-constrained-leaf',
    {
      type: 'object',
      properties: {
        s: { type: 'object', properties: { b: { type: 'string', minLength: 2, pattern: '^a' } }, required: ['b'] },
        n: { type: 'object', properties: { b: { type: 'number', minimum: 1, multipleOf: 2 } }, required: ['b'] },
        a: { type: 'object', properties: { b: { type: 'array', items: { type: 'string' }, minItems: 1 } } },
      },
      required: ['s', 'n'],
    },
  ],
  // A `dependentSchemas` / `dependencies` subschema applies to the *object*, and
  // the object variable is typed `Record<string, unknown>` — so a string or
  // number keyword in one compiled to `typeof obj === 'string'`, which narrows to
  // `never` and takes the check behind it down with it (`TS2367` + `TS2339`).
  [
    'dependent-schemas-cross-family',
    { type: 'object', dependentSchemas: { t: { minLength: 2, minimum: 1, minItems: 1 } } },
  ],
  ['dependencies-cross-family', { type: 'object', dependencies: { t: { const: 'x', maxLength: 2 } } }],
  // Draft-07 spellings: an array `items` is the tuple and `additionalItems` its
  // tail. Both used to emit nothing at all.
  ['draft07-tuple', { type: 'array', items: [{ type: 'string' }, { type: 'number' }], additionalItems: false }],
  ['draft07-tuple-tail', { type: 'array', items: [{ type: 'string' }], additionalItems: { type: 'number' } }],
  ['empty-array', { type: 'array', items: false }],
  // Combinator branches TypeScript can decide statically. Emitting the branch
  // anyway left code it proves unreachable (`TS7027`, and the repo compiles this
  // output with `allowUnreachableCode: false`) — 58 of them across the two
  // vendored corpora.
  ['anyof-with-always-matching-branch', { anyOf: [{ type: 'string' }, true] }],
  ['anyof-with-empty-branch', { anyOf: [{ type: 'string' }, {}] }],
  ['if-true', { if: true, then: { type: 'string' }, else: { type: 'number' } }],
  ['if-false', { if: false, then: { type: 'string' }, else: { type: 'number' } }],
  ['not-false', { not: false }],
  ['not-true', { type: 'string', not: true }],
  // A `type: "object"` root whose combinator branches belong to another family.
  // The object validator read them against the narrowed `Record<string, unknown>`
  // (later `object`), so `x === "auto"` was `TS2367` plus a cascade on `never`.
  [
    'object-root-with-cross-family-oneof',
    {
      type: 'object',
      oneOf: [
        { type: 'string', enum: ['auto'] },
        { type: 'object', required: ['x'] },
      ],
    },
  ],
  // `unevaluatedProperties` reads each leftover key through a cast, which no
  // `typeof` in front of it can narrow — so a *constrained* subschema emitted
  // `.length` on `unknown`.
  [
    'unevaluated-properties-constrained',
    {
      type: 'object',
      properties: { foo: { type: 'string' } },
      unevaluatedProperties: { type: 'string', maxLength: 2 },
    },
  ],
  [
    'unevaluated-items-constrained',
    { type: 'array', prefixItems: [{ type: 'string' }], unevaluatedItems: { type: 'number', minimum: 2 } },
  ],
  [
    'proto-property',
    JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string","minLength":3}},"required":["__proto__"]}',
    ) as JSONSchema,
  ],
]

/**
 * The repo's own flags. `strict` alone is not the bar the generated output has to
 * clear — `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on in
 * the root `tsconfig.json`, so they are what a consumer compiles this with.
 */
const OPTIONS: ts.CompilerOptions = {
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  noImplicitOverride: true,
  noFallthroughCasesInSwitch: true,
  useUnknownInCatchVariables: true,
  allowUnusedLabels: false,
  allowUnreachableCode: false,
  noImplicitReturns: true,
  noEmit: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
}

/** Joins a relative import specifier onto its importer's directory. */
const resolveVirtualPath = (fromFile: string, specifier: string): string => {
  const segments = fromFile.slice(1).split('/').slice(0, -1)
  for (const part of specifier.replace(/\.js$/, '.ts').split('/')) {
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
  // The files exist only in this map, so the compiler's disk-backed resolution
  // finds nothing — every relative import has to be resolved by hand.
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
  it('emits type-correct validator files under the repo strict flags', { timeout: 120_000 }, async () => {
    const sources = new Map<string, string>()
    for (const [name, schema] of CASES) {
      const files = await buildValidatorSchema(schema, 'Doc')
      for (const file of files) sources.set(`/${name}/${file.filename}`, file.content)
    }

    expect(typeErrors(sources)).toEqual([])
  })
})
