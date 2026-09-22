import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { buildSchema } from './build-schema'
import { makeRng, pick } from './differential.test-utils'

/**
 * The `generated-code-types` suite proves a hand-picked corpus type-checks; this
 * one proves *fuzzed* documents do, across every option the generator exposes.
 *
 * Everything here is emitted by string concatenation, so a type definition and
 * the code built from it drift apart in shape combinations no fixed corpus
 * enumerates — and the result is not a syntax error, it is a generated package
 * that does not build. This found five: a property named after an
 * `Object.prototype` member (whose accessor is a conditional expression, which
 * TypeScript cannot narrow across repeated reads), the subschema matcher's
 * record and tuple-element views (same problem, same cause), a fast-path literal
 * whose `unknown` reads narrow to `{} | null` and then refuse to convert to a
 * `$ref` type, and a fallback literal carrying a prototype-member name one level
 * down.
 *
 * Documents carry `$defs` and `$ref`s so the multi-file output — the barrel, the
 * cross-file imports, the embedded helpers — is compiled as one program, the way
 * a consumer compiles it.
 */

type Rng = () => number
type Node = Record<string, unknown>

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
  allowImportingTsExtensions: true,
  skipLibCheck: true,
}

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
  host.readFile = (f) => sources.get(f) ?? readFile(f)
  host.fileExists = (f) => sources.has(f) || fileExists(f)
  host.getSourceFile = (f, v, onError, shouldCreate) => {
    const content = sources.get(f)
    return content !== undefined ? ts.createSourceFile(f, content, v, true) : getSourceFile(f, v, onError, shouldCreate)
  }
  host.resolveModuleNameLiterals = (lits, containing) =>
    lits.map((l) => {
      const resolved = resolveVirtualPath(containing, l.text)
      return sources.has(resolved)
        ? { resolvedModule: { resolvedFileName: resolved, extension: ts.Extension.Ts } }
        : { resolvedModule: undefined }
    })
  const program = ts.createProgram([...sources.keys()], OPTIONS, host)
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file !== undefined)
    .map((d) => `${d.file?.fileName}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)
}

const KEYS = ['id', 'name', 'x-a', 'a b', 'constructor', '0']
const DEFS = ['alpha', 'beta']

const leaf = (rng: Rng): Node => {
  const k = rng()
  if (k < 0.1) return { type: 'string', enum: ['a', 'b'] }
  if (k < 0.16) return { const: pick(rng, ['a', 1, true, null]) }
  if (k < 0.24) return { type: 'string', minLength: 1, maxLength: 4 }
  if (k < 0.32) return { type: 'integer', minimum: 1, maximum: 10 }
  if (k < 0.4) return { type: ['string', 'null'] }
  if (k < 0.46) return { type: 'number', multipleOf: 2, minimum: 3 }
  return { type: pick(rng, ['string', 'number', 'integer', 'boolean', 'null']) }
}

const value = (rng: Rng, depth: number): Node => {
  if (depth <= 0) return leaf(rng)
  const k = rng()
  if (k < 0.18) return obj(rng, depth)
  if (k < 0.28) return { type: 'array', items: rng() < 0.5 ? obj(rng, depth - 1) : leaf(rng), minItems: 1 }
  if (k < 0.34) return { type: 'array', prefixItems: [leaf(rng), leaf(rng)], items: false, minItems: 2 }
  if (k < 0.4) return { $ref: `#/$defs/${pick(rng, DEFS)}` }
  if (k < 0.45) return { type: 'array', items: { $ref: `#/$defs/${pick(rng, DEFS)}` } }
  if (k < 0.5) return { type: 'object', additionalProperties: { $ref: `#/$defs/${pick(rng, DEFS)}` } }
  if (k < 0.55) return { oneOf: [leaf(rng), { type: 'boolean' }] }
  if (k < 0.6) return { allOf: [obj(rng, depth - 1)] }
  if (k < 0.65) return { type: 'object', patternProperties: { '^x-': leaf(rng) } }
  if (k < 0.7) return { type: 'object', properties: { q: leaf(rng) }, required: ['q'], additionalProperties: leaf(rng) }
  return leaf(rng)
}

const obj = (rng: Rng, depth: number): Node => {
  const properties: Record<string, Node> = {}
  const declared: string[] = []
  const n = 1 + Math.floor(rng() * 3)
  for (let i = 0; i < n; i++) {
    const key = pick(rng, KEYS)
    if (Object.hasOwn(properties, key)) continue
    properties[key] = value(rng, depth - 1)
    declared.push(key)
  }
  const required = rng() < 0.5 ? declared : declared.filter(() => rng() < 0.6)
  const schema: Node = { type: 'object', properties }
  if (required.length > 0) schema['required'] = required
  if (rng() < 0.25) schema['additionalProperties'] = false
  if (rng() < 0.15) schema['minProperties'] = 1
  return schema
}

const document = (rng: Rng): Node => ({
  ...obj(rng, 3),
  $defs: Object.fromEntries(DEFS.map((name) => [name, obj(rng, 2)])),
})

type Mode = readonly [string, boolean, boolean, boolean, boolean, boolean]
const MODES: readonly Mode[] = [
  ['coerce', false, false, false, false, false],
  ['strict', true, false, false, false, false],
  ['readonly', false, true, false, false, false],
  ['strip', false, false, true, false, false],
  ['strict-strip', true, false, true, false, false],
  ['ci', false, false, false, true, false],
  ['types', false, false, false, false, true],
]

describe('generated output type-checks across the option matrix', () => {
  for (const seed of [0x501, 0x502, 0x503, 0x504, 0x505, 0x506, 0x507, 0x508, 0x509, 0x50a]) {
    it(`type-checks fuzzed documents (seed ${seed})`, { timeout: 300_000 }, async () => {
      const rng = makeRng(seed)
      const sources = new Map<string, string>()
      const refused: string[] = []
      for (let i = 0; i < 25; i++) {
        const schema = document(rng) as JSONSchema
        for (const [mode, strict, readonly, strip, ci, typesOnly] of MODES) {
          let files: { filename: string; content: string }[]
          try {
            files = await buildSchema(
              schema,
              'Doc',
              undefined,
              typesOnly,
              false,
              strict,
              'embedded',
              './',
              readonly,
              strip,
              '',
              'ts',
              ci,
            )
          } catch (e) {
            const msg = (e as Error).message
            if (msg.includes('unsupported keyword')) continue
            refused.push(`${mode}: ${msg.slice(0, 200)}\n  ${JSON.stringify(schema).slice(0, 500)}`)
            continue
          }
          for (const file of files) sources.set(`/s${i}-${mode}/${file.filename}`, file.content)
        }
      }
      expect(refused, refused.join('\n\n')).toEqual([])
      const errors = typeErrors(sources)
      const kinds = new Map<string, string>()
      for (const e of errors) {
        const msg = e.slice(e.indexOf(': ') + 2)
        if (!kinds.has(msg)) kinds.set(msg, e)
      }
      // One example per distinct message, with the file it came from, so a
      // failure names the shape rather than repeating one error a hundred times.
      const detail = [...kinds.values()].map((e) => {
        const file = e.slice(0, e.lastIndexOf('.ts:') + 3)
        return `${e}\n===== ${file}\n${sources.get(file) ?? ''}`
      })
      expect(errors.length, detail.join('\n\n')).toBe(0)
    })
  }
})
