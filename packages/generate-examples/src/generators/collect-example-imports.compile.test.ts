import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { generateExampleFile } from './generate-files'

/**
 * A generated example file references its `$ref` dependencies as bare `Xxx`
 * types and `XxxArbitrary` values, importing both from the ref's generated file.
 * When `$ref`s hide inside a tuple, a nested combinator, or `patternProperties`,
 * the import collector must still emit those imports — otherwise the file
 * references a name that was never imported and fails to compile.
 *
 * A syntax-only pass (`ts.transpileModule`) cannot catch that: an unimported
 * identifier is valid *syntax*. So we type-check the whole file with a real
 * program, stubbing `fast-check` and every referenced ref module, and assert it
 * reports no errors. Before the collector recursed into these surfaces the
 * generated code raised `Cannot find name 'Foo' / 'FooArbitrary'`.
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
export const letrec: any
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

// Spinning up a real `ts` program loads the default lib files from disk, which
// is slow on a cold CI runner (subsequent programs reuse the warm fs cache), so
// give each case room beyond the 5s default rather than time out on the first.
const COMPILE_TIMEOUT = 30_000

describe('collect-example-imports compile check', () => {
  it('emits an import for a $ref nested inside a tuple (prefixItems)', { timeout: COMPILE_TIMEOUT }, () => {
    const schema: JSONSchema = {
      type: 'array',
      prefixItems: [{ $ref: '#/$defs/foo' }, { type: 'string' }],
    }
    const code = generateExampleFile(schema, 'Tuple', { rootSchema })
    expect(code).toContain("from './foo.js'")
    expect(compileErrors(code)).toEqual([])
  })

  it('emits an import for a $ref inside a property-level oneOf', { timeout: COMPILE_TIMEOUT }, () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { pick: { oneOf: [{ $ref: '#/$defs/foo' }, { type: 'string' }] } },
      required: ['pick'],
    }
    const code = generateExampleFile(schema, 'PropOneOf', { rootSchema })
    expect(code).toContain("from './foo.js'")
    expect(compileErrors(code)).toEqual([])
  })

  it('emits an import for a $ref inside patternProperties', { timeout: COMPILE_TIMEOUT }, () => {
    const schema: JSONSchema = {
      type: 'object',
      patternProperties: { '^x-': { $ref: '#/$defs/foo' } },
    }
    const code = generateExampleFile(schema, 'PatternProps', { rootSchema })
    expect(code).toContain("from './foo.js'")
    expect(compileErrors(code)).toEqual([])
  })
})
