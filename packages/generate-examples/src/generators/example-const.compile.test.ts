import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { generateExampleFile } from './generate-files'

/**
 * A schema can demand an object key that the generated *type* never declares: a
 * `required` name with no `properties` entry, a `dependentRequired` /
 * `dependentSchemas` dependency, or a `minProperties` filler on an object with no
 * index signature. The derived example still carries the key — a fixture missing
 * something its schema requires is broken data — so the emitted literal has an
 * excess property, and TypeScript rejects the whole module over it.
 *
 * `expect(code).toContain(...)` cannot catch that; only a type-checker can. So
 * these cases go through the same in-memory `ts` program the import test uses,
 * with `fast-check` and the runtime validators stubbed, and assert the generated
 * file reports no errors at all.
 */

const VFS_DIR = '/vfs'
const MAIN_FILE = `${VFS_DIR}/main.ts`

/**
 * A `fast-check` stub exporting the generic `Arbitrary<T>` type plus every
 * combinator the generator can emit. `Arbitrary<T>` carries the `.map`/`.filter`
 * methods the generator chains onto arbitraries (format `.map`, pattern-length
 * `.filter`, the `additionalProperties` merge, and the validating `.filter`), so
 * their callback parameters are contextually typed rather than implicitly `any`.
 * Combinators return `Arbitrary<any>` — call shapes never matter, only that
 * `fc.<member>` resolves and chains.
 */
const FAST_CHECK_STUB = `
export type Arbitrary<T> = {
  readonly __arb: T
  // Both overloads, matching real fast-check: the generated validating filter
  // widens its base to \`Arbitrary<unknown>\` and narrows with a type guard, which
  // only type-checks against the refinement signature.
  filter<U extends T>(refinement: (value: T) => value is U): Arbitrary<U>
  filter(predicate: (value: T) => boolean): Arbitrary<T>
  map<U>(mapper: (value: T) => U): Arbitrary<U>
  chain<U>(chainer: (value: T) => Arbitrary<U>): Arbitrary<U>
}
type Comb = (...args: any[]) => Arbitrary<any>
export const string: Comb
export const emailAddress: Comb
export const uuid: Comb
export const webUrl: Comb
export const date: Comb
export const domain: Comb
export const ipV4: Comb
export const ipV6: Comb
export const stringMatching: Comb
export const integer: Comb
export const double: Comb
export const boolean: Comb
export const constant: Comb
export const constantFrom: Comb
export const array: Comb
export const uniqueArray: Comb
export const tuple: Comb
export const record: Comb
export const dictionary: Comb
export const object: Comb
export const oneof: Comb
export const anything: Comb
export const bigInt: Comb
export const letrec: <T>(
  builder: (tie: <K extends keyof T>(key: K) => Arbitrary<T[K]>) => { [K in keyof T]: Arbitrary<T[K]> },
) => { [K in keyof T]: Arbitrary<T[K]> }
`

/** A `@amritk/runtime-validators` stub exporting the `validate` a filtered arbitrary calls. */
const RUNTIME_VALIDATORS_STUB = `export const validate: any\n`

/** Bare module specifiers stubbed directly, so they aren't treated as `$ref` modules. */
const STUBBED_MODULES = new Set(['fast-check', '@amritk/runtime-validators'])

/** Parses `import { type Foo, FooArbitrary } from './foo.js'` lines out of generated code. */
const parseRefImports = (code: string): { module: string; bindings: string[] }[] =>
  code
    .split('\n')
    .map((line) => /^import\s*\{([^}]*)\}\s*from\s*'([^']+)'/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null && !STUBBED_MODULES.has(match[2] as string))
    .map((match) => ({
      module: match[2] as string,
      bindings: (match[1] as string)
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean),
    }))

/** Builds a stub module exporting each imported binding as a type or a value. */
const stubForBindings = (bindings: string[]): string =>
  bindings
    .map((binding) =>
      binding.startsWith('type ')
        ? `export type ${binding.slice('type '.length)} = unknown`
        : `export const ${binding}: any = undefined`,
    )
    .join('\n')

/** Type-checks a generated example file in-memory and returns its error diagnostics. */
const compileErrors = (code: string): string[] => {
  const files: Record<string, string> = {
    [MAIN_FILE]: code,
    [`${VFS_DIR}/fast-check.d.ts`]: FAST_CHECK_STUB,
    [`${VFS_DIR}/runtime-validators.d.ts`]: RUNTIME_VALIDATORS_STUB,
  }
  const moduleMap: Record<string, string> = {
    'fast-check': `${VFS_DIR}/fast-check.d.ts`,
    '@amritk/runtime-validators': `${VFS_DIR}/runtime-validators.d.ts`,
  }

  for (const { module, bindings } of parseRefImports(code)) {
    // './foo.js' → foo.ts
    const stem = module.replace(/^\.\//, '').replace(/\.js$/, '')
    const path = `${VFS_DIR}/${stem}.ts`
    files[path] = stubForBindings(bindings)
    moduleMap[module] = path
  }

  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    // The bundled `import { type X, XArbitrary }` intentionally brings in both
    // halves even when only one side references the ref, so don't fail on the
    // unused half — this test asserts references *resolve*, not lint cleanliness.
    noUnusedLocals: false,
  }

  const host = ts.createCompilerHost(options)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const contents = files[fileName]
    return contents !== undefined
      ? ts.createSourceFile(fileName, contents, languageVersion, true)
      : originalGetSourceFile(fileName, languageVersion, onError, shouldCreate)
  }
  host.fileExists = (fileName) => fileName in files || ts.sys.fileExists(fileName)
  host.readFile = (fileName) => files[fileName] ?? ts.sys.readFile(fileName)
  host.resolveModuleNames = (moduleNames) =>
    moduleNames.map((name) => {
      const resolvedFileName = moduleMap[name]
      return resolvedFileName ? { resolvedFileName } : undefined
    })

  const program = ts.createProgram([MAIN_FILE], options, host)
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

const rootSchema = {
  $defs: { foo: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] } },
}

// Spinning up a real `ts` program loads the default lib files from disk, which is
// slow on a cold CI runner, so give each case room beyond the 5s default.
const COMPILE_TIMEOUT = 30_000

/** Schemas whose declared type cannot hold every key the example must carry. */
const UNDECLARED_KEY_CASES: ReadonlyArray<{ name: string; schema: JSONSchema; key: string }> = [
  {
    name: 'a required key with no properties entry',
    schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'b'] },
    key: 'b',
  },
  {
    name: 'a dependentRequired dependency with no properties entry',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      dependentRequired: { a: ['b'] },
    },
    key: 'b',
  },
  {
    name: 'a dependentSchemas property the parent never declares',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      dependentSchemas: { a: { properties: { b: { type: 'number' } }, required: ['b'] } },
    },
    key: 'b',
  },
  {
    name: 'a minProperties filler on an object with no index signature',
    schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], minProperties: 3 },
    key: 'extra',
  },
]

/** Schemas whose index signature already makes room for the synthesized keys. */
const DECLARED_KEY_CASES: ReadonlyArray<{ name: string; schema: JSONSchema }> = [
  {
    name: 'minProperties alongside additionalProperties',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      minProperties: 3,
      additionalProperties: { type: 'string' },
    },
  },
  {
    name: 'minProperties alongside patternProperties',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      minProperties: 2,
      patternProperties: { '^x-': { type: 'string' } },
    },
  },
]

/**
 * Authored hints whose value contradicts the schema they sit in. Real documents
 * carry these constantly — a `default` left behind by an edit, an `examples`
 * entry for a field whose type later changed — and the generated type follows
 * the schema, never the hint.
 */
const MISMATCHED_HINT_CASES: ReadonlyArray<{ name: string; schema: JSONSchema; rejected: string }> = [
  { name: 'a default of the wrong type', schema: { type: 'string', default: 42 }, rejected: '42' },
  { name: 'a null default on a string', schema: { type: 'string', default: null }, rejected: 'null' },
  { name: 'an examples entry of the wrong type', schema: { type: 'number', examples: ['hello'] }, rejected: '"hello"' },
  {
    name: 'an object default missing a required key',
    schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], default: {} },
    rejected: '{  }',
  },
]

describe('generated example const compiles', () => {
  for (const { name, schema, rejected } of MISMATCHED_HINT_CASES) {
    it(`falls back on ${name}`, { timeout: COMPILE_TIMEOUT }, () => {
      const code = generateExampleFile(schema, 'Foo')
      expect(code).not.toContain(`export const fooExample: Foo = ${rejected}`)
      expect(compileErrors(code)).toEqual([])
    })
  }

  it('still prefers an authored hint that does satisfy its schema', { timeout: COMPILE_TIMEOUT }, () => {
    const code = generateExampleFile({ type: 'string', default: 'hi' } as JSONSchema, 'Foo')
    expect(code).toContain('export const fooExample: Foo = "hi"')
    expect(compileErrors(code)).toEqual([])
  })

  for (const { name, schema, key } of UNDECLARED_KEY_CASES) {
    it(`keeps and asserts ${name}`, { timeout: COMPILE_TIMEOUT }, () => {
      const code = generateExampleFile(schema, 'T', { rootSchema })
      // The key stays in the value — dropping it would emit invalid fixture data.
      expect(code).toContain(`export const tExample: T = `)
      expect(code).toContain(`"${key}"`)
      expect(code).toContain(' as T')
      expect(compileErrors(code)).toEqual([])
    })
  }

  for (const { name, schema } of DECLARED_KEY_CASES) {
    it(`emits a bare literal for ${name}`, { timeout: COMPILE_TIMEOUT }, () => {
      const code = generateExampleFile(schema, 'T', { rootSchema })
      // An index signature covers the synthesized keys, so nothing needs asserting
      // and the literal keeps its full excess-property checking.
      expect(code).not.toContain(' as T')
      expect(compileErrors(code)).toEqual([])
    })
  }

  it('asserts a recursive definition whose example cuts the cycle', { timeout: COMPILE_TIMEOUT }, () => {
    // The canonical linked list. The example has to stop somewhere and stops with
    // `null`, which `type Node = { next: Node }` does not admit — so the
    // definition's own generated file did not compile.
    const recursiveRoot = {
      $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } }, required: ['next'] } },
    }
    const code = generateExampleFile(recursiveRoot.$defs.node as JSONSchema, 'Node', {
      rootSchema: recursiveRoot,
      selfRef: '#/$defs/node',
    })
    expect(code).toContain('export const nodeExample: Node = { "next": { "next": null } } as unknown as Node')
    expect(compileErrors(code)).toEqual([])
  })

  it('asserts a nested example whose $ref definition needs one', { timeout: COMPILE_TIMEOUT }, () => {
    // The flag has to survive the per-ref memo: the key is invented while deriving
    // the definition, several levels below the const being emitted.
    const nestedRoot = {
      $defs: { inner: { type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'b'] } },
    }
    const schema: JSONSchema = {
      type: 'object',
      properties: { child: { $ref: '#/$defs/inner' } },
      required: ['child'],
    }
    const code = generateExampleFile(schema, 'Outer', { rootSchema: nestedRoot })
    expect(code).toContain(' as Outer')
    expect(compileErrors(code)).toEqual([])
  })
})
