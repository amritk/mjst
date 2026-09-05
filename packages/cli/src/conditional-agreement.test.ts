import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildSchema } from '@amritk/generate-parsers'
import { buildValidatorSchema } from '@amritk/generate-validators'
import { buildSync } from 'esbuild'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The CLI emits three readings of one schema — a type, a parser, a validator —
 * and they are only useful together when they agree on what an instance is.
 * For `if`/`then`/`else` they did not: the validators and parsers judged a
 * conditional correctly while the declared type folded `if` and `then` in as
 * required properties, so `{}` validated at runtime and failed to compile.
 *
 * This suite holds the three to one verdict per sample. Everything the
 * validator accepts must be assignable to the generated type, must come back
 * unchanged from the strict parser, and must come back from the coercing one
 * with its own keys intact and still valid (a coercing parser may add what a
 * composed definition defaults, so it is not held to identity); everything it
 * rejects the strict parser must throw on. Where the type can narrow as far as the schema does (a boolean or
 * enum discriminant), the sample the validator rejects must fail to compile
 * too; where the type is deliberately lossy, the sample compiles and the case
 * says so.
 *
 * The type check is a real `tsc` program over the generated files plus a
 * probe that assigns each sample, so a parser whose declared return type
 * drifted from the validator's would fail here as well.
 */
type Sample = {
  readonly value: Record<string, unknown>
  /** What the schema — and so the validator and the strict parser — says. */
  readonly valid: boolean
  /**
   * Whether the generated type accepts the value. Defaults to `valid`; set to
   * `true` on an invalid sample the type is too coarse to refuse.
   */
  readonly typed?: boolean
}

type Case = {
  readonly name: string
  readonly schema: JSONSchema
  readonly samples: readonly Sample[]
}

const CASES: readonly Case[] = [
  // The downstream shape that blocked an upgrade: "`b` requires `a`" written
  // as an `allOf` member beside the property block it tests.
  {
    name: 'allof-conditional',
    schema: {
      type: 'object',
      allOf: [
        {
          if: { properties: { a: { const: true } }, required: ['a'] },
          then: { properties: { b: { const: true } }, required: ['b'] },
        },
      ],
      properties: { a: { type: 'boolean' }, b: { type: 'boolean' } },
      additionalProperties: false,
    },
    samples: [
      { value: {}, valid: true },
      { value: { a: false }, valid: true },
      { value: { a: false, b: true }, valid: true },
      { value: { b: false }, valid: true },
      { value: { a: true, b: true }, valid: true },
      { value: { a: true }, valid: false },
      { value: { a: true, b: false }, valid: false },
    ],
  },
  {
    name: 'bare-if-then-else',
    schema: {
      type: 'object',
      properties: { a: { type: 'boolean' }, b: { type: 'boolean' }, c: { type: 'string' } },
      if: { properties: { a: { const: true } }, required: ['a'] },
      then: { properties: { b: { const: true } }, required: ['b'] },
      else: { required: ['c'] },
    },
    samples: [
      { value: { a: true, b: true }, valid: true },
      { value: { a: true, b: true, c: 'x' }, valid: true },
      { value: { a: false, c: 'x' }, valid: true },
      { value: { c: 'x' }, valid: true },
      { value: {}, valid: false },
      { value: { a: true }, valid: false },
      { value: { a: false }, valid: false },
      { value: { a: true, b: false, c: 'x' }, valid: false },
    ],
  },
  {
    name: 'then-ref',
    schema: {
      type: 'object',
      properties: { kind: { enum: ['a', 'b'] } },
      if: { properties: { kind: { const: 'a' } }, required: ['kind'] },
      then: { $ref: '#/$defs/extra' },
      $defs: { extra: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] } },
    },
    samples: [
      { value: {}, valid: true },
      { value: { kind: 'b' }, valid: true },
      { value: { kind: 'a', x: '1' }, valid: true },
      { value: { kind: 'a' }, valid: false },
      { value: { kind: 'a', x: 1 }, valid: false },
    ],
  },
  // OpenAPI's security-scheme shape: the rules are `$ref`s to conditional
  // definitions, read through against the `type` enumerated here.
  {
    name: 'allof-ref-conditionals',
    schema: {
      type: 'object',
      properties: { type: { enum: ['apiKey', 'http'] }, description: { type: 'string' } },
      required: ['type'],
      allOf: [{ $ref: '#/$defs/typeHttp' }, { $ref: '#/$defs/typeApiKey' }],
      $defs: {
        typeHttp: {
          if: { properties: { type: { const: 'http' } }, required: ['type'] },
          then: { properties: { scheme: { type: 'string' } }, required: ['scheme'] },
        },
        typeApiKey: {
          if: { properties: { type: { const: 'apiKey' } }, required: ['type'] },
          then: { properties: { name: { type: 'string' } }, required: ['name'] },
        },
      },
    },
    samples: [
      { value: { type: 'http', scheme: 'basic' }, valid: true },
      { value: { type: 'apiKey', name: 'X-Key', description: 'header' }, valid: true },
      { value: { type: 'http' }, valid: false },
      { value: { type: 'apiKey' }, valid: false },
      { value: { type: 'apiKey', scheme: 'basic' }, valid: false },
      { value: {}, valid: false },
    ],
  },
  // A string discriminant has no finite domain to negate against, so the type
  // drops the conditional: sound, and too coarse to refuse `{ kind: 'strict' }`.
  {
    name: 'dropped-conditional',
    schema: {
      type: 'object',
      properties: { kind: { type: 'string' }, level: { type: 'number' } },
      if: { properties: { kind: { const: 'strict' } }, required: ['kind'] },
      then: { required: ['level'] },
    },
    samples: [
      { value: {}, valid: true },
      { value: { kind: 'lax' }, valid: true },
      { value: { kind: 'strict', level: 1 }, valid: true },
      { value: { kind: 'strict' }, valid: false, typed: true },
    ],
  },
  {
    name: 'nested-conditional',
    schema: {
      type: 'object',
      properties: {
        inner: {
          type: 'object',
          properties: { a: { type: 'boolean' }, b: { type: 'string' } },
          if: { properties: { a: { const: true } }, required: ['a'] },
          then: { required: ['b'] },
        },
      },
    },
    samples: [
      { value: {}, valid: true },
      { value: { inner: {} }, valid: true },
      { value: { inner: { a: false } }, valid: true },
      { value: { inner: { a: true, b: 'x' } }, valid: true },
      { value: { inner: { a: true } }, valid: false },
    ],
  },
]

/** The repo's own strictness, the same set `generated-code-types` compiles under. */
const OPTIONS: ts.CompilerOptions = {
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  noImplicitReturns: true,
  noEmit: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  skipLibCheck: true,
}

/** Every generated file for one case, keyed by its path under the case directory. */
type Generated = ReadonlyMap<string, string>

const generate = async ({ schema }: Case): Promise<Generated> => {
  const files = new Map<string, string>()
  const add = (dir: string, generated: readonly { filename: string; content: string }[]): void => {
    for (const file of generated) files.set(`${dir}/${file.filename}`, file.content)
  }
  add('validators', await buildValidatorSchema(schema, 'Doc'))
  add('strict', await buildSchema(schema, 'Doc', undefined, false, false, true, 'embedded', './'))
  add('coerce', await buildSchema(schema, 'Doc', undefined, false, false, false, 'embedded', './'))
  return files
}

/**
 * A probe that assigns every sample to the generated type. `as const` keeps
 * the literals (`a: true` must stay `true`, not `boolean`) while making the
 * value a non-fresh object, so an extra key a lossy type never declares is
 * not an excess-property error unrelated to what is being tested. The
 * parser's return type flows into the same annotation, so the three readings
 * are checked against each other, not just against the samples.
 */
const probe = ({ samples }: Case): string => {
  const lines = [
    "import { type Doc, validateDoc } from './validators/doc.ts'",
    "import { parseDoc as parseStrict } from './strict/doc.ts'",
    "import { parseDoc as parseCoerce } from './coerce/doc.ts'",
    'export const verdicts: unknown[] = []',
  ]
  samples.forEach((sample, index) => {
    lines.push(`const sample${index} = ${JSON.stringify(sample.value)} as const`)
    if (!(sample.typed ?? sample.valid))
      lines.push('// @ts-expect-error the schema rejects this value, and so must the type')
    lines.push(`const typed${index}: Doc = sample${index}`)
    lines.push(`verdicts.push(validateDoc(typed${index}))`)
  })
  lines.push('const strict: Doc = parseStrict(sample0)', 'const coerced: Doc = parseCoerce(sample0)')
  lines.push('verdicts.push(strict, coerced)')
  return `${lines.join('\n')}\n`
}

const typeErrors = (root: string, sources: Generated): readonly string[] => {
  const host = ts.createCompilerHost(OPTIONS)
  const files = new Map([...sources].map(([name, content]) => [`${root}/${name}`, content]))
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const getSourceFile = host.getSourceFile.bind(host)
  host.readFile = (fileName) => files.get(fileName) ?? readFile(fileName)
  host.fileExists = (fileName) => files.has(fileName) || fileExists(fileName)
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const content = files.get(fileName)
    return content === undefined
      ? getSourceFile(fileName, languageVersion, onError, shouldCreate)
      : ts.createSourceFile(fileName, content, languageVersion, true)
  }
  // The generated imports name `.js` files that only exist here as `.ts`.
  host.resolveModuleNameLiterals = (literals, containingFile) =>
    literals.map((literal) => {
      const resolved = join(dirname(containingFile), literal.text).replace(/\.js$/, '.ts')
      return files.has(resolved)
        ? { resolvedModule: { resolvedFileName: resolved, extension: ts.Extension.Ts } }
        : { resolvedModule: undefined }
    })
  const program = ts.createProgram([...files.keys()], OPTIONS, host)
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file !== undefined)
    .map((diagnostic) => {
      const where = diagnostic.file?.fileName.slice(root.length + 1)
      const line =
        diagnostic.file && diagnostic.start !== undefined
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
          : 0
      return `${where}:${line}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`
    })
}

/** The generated validators answer `true`, or an object carrying the errors. */
type Verdict = true | { readonly valid: false }
type Runtime = {
  readonly validate: (input: unknown) => Verdict
  readonly parseStrict: (input: unknown) => unknown
  readonly parseCoerce: (input: unknown) => unknown
}

/**
 * Bundles the generated modules from disk and evaluates them, so the parser
 * and validator under test are the shipped files, helpers and all.
 */
const load = (root: string, entry: string): Record<string, unknown> => {
  const { outputFiles } = buildSync({
    entryPoints: [join(root, entry)],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
  })
  const code = outputFiles[0]?.text ?? ''
  const mod = { exports: {} as Record<string, unknown> }
  new Function('module', 'exports', code)(mod, mod.exports)
  return mod.exports
}

let workspace = ''
const runtimes = new Map<string, Runtime>()
const typeDiagnostics = new Map<string, readonly string[]>()

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'mjst-conditional-'))
  for (const testCase of CASES) {
    const root = join(workspace, testCase.name)
    const sources = new Map([...(await generate(testCase)), ['probe.ts', probe(testCase)]])
    for (const [name, content] of sources) {
      await mkdir(dirname(join(root, name)), { recursive: true })
      await writeFile(join(root, name), content)
    }
    typeDiagnostics.set(testCase.name, typeErrors(root, sources))
    runtimes.set(testCase.name, {
      validate: load(root, 'validators/doc.ts')['validateDoc'] as Runtime['validate'],
      parseStrict: load(root, 'strict/doc.ts')['parseDoc'] as Runtime['parseStrict'],
      parseCoerce: load(root, 'coerce/doc.ts')['parseDoc'] as Runtime['parseCoerce'],
    })
  }
}, 120_000)

afterAll(async () => {
  if (workspace !== '') await rm(workspace, { recursive: true, force: true })
})

describe('conditional-agreement', () => {
  for (const testCase of CASES) {
    it(`${testCase.name}: the validator gives the schema's verdict`, () => {
      const runtime = runtimes.get(testCase.name)
      expect(runtime).toBeDefined()
      for (const sample of testCase.samples) {
        expect(runtime?.validate(sample.value) === true, JSON.stringify(sample.value)).toBe(sample.valid)
      }
    })

    it(`${testCase.name}: the generated type accepts exactly what it says it does`, () => {
      expect(typeDiagnostics.get(testCase.name)).toEqual([])
    })

    it(`${testCase.name}: both parsers agree with the validator`, () => {
      const runtime = runtimes.get(testCase.name)
      expect(runtime).toBeDefined()
      for (const sample of testCase.samples) {
        const label = JSON.stringify(sample.value)
        if (!sample.valid) {
          expect(() => runtime?.parseStrict(sample.value), label).toThrow()
          continue
        }
        expect(runtime?.parseStrict(sample.value), label).toEqual(sample.value)
        const coerced = runtime?.parseCoerce(sample.value)
        expect(coerced, label).toMatchObject(sample.value)
        expect(runtime?.validate(coerced), label).toBe(true)
      }
    })
  }
})
