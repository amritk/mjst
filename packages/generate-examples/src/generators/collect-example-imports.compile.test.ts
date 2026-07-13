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
 * combinator the generator can emit, each typed `any` so call shapes never
 * matter — only that `fc.<member>` resolves.
 */
const FAST_CHECK_STUB = `
export type Arbitrary<T> = { readonly __arb: T }
export const string: any
export const emailAddress: any
export const uuid: any
export const webUrl: any
export const date: any
export const domain: any
export const ipV4: any
export const ipV6: any
export const stringMatching: any
export const integer: any
export const double: any
export const boolean: any
export const constant: any
export const constantFrom: any
export const array: any
export const uniqueArray: any
export const tuple: any
export const record: any
export const dictionary: any
export const object: any
export const oneof: any
export const anything: any
export const bigInt: any
export const letrec: any
`

/** Parses `import { type Foo, FooArbitrary } from './foo.js'` lines out of generated code. */
const parseRefImports = (code: string): { module: string; bindings: string[] }[] =>
  code
    .split('\n')
    .map((line) => /^import\s*\{([^}]*)\}\s*from\s*'([^']+)'/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null && match[2] !== 'fast-check')
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
  }
  const moduleMap: Record<string, string> = { 'fast-check': `${VFS_DIR}/fast-check.d.ts` }

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

describe('collect-example-imports compile check', () => {
  it('emits an import for a $ref nested inside a tuple (prefixItems)', () => {
    const schema: JSONSchema = {
      type: 'array',
      prefixItems: [{ $ref: '#/$defs/foo' }, { type: 'string' }],
    }
    const code = generateExampleFile(schema, 'Tuple', { rootSchema })
    expect(code).toContain("from './foo.js'")
    expect(compileErrors(code)).toEqual([])
  })

  it('emits an import for a $ref inside a property-level oneOf', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { pick: { oneOf: [{ $ref: '#/$defs/foo' }, { type: 'string' }] } },
      required: ['pick'],
    }
    const code = generateExampleFile(schema, 'PropOneOf', { rootSchema })
    expect(code).toContain("from './foo.js'")
    expect(compileErrors(code)).toEqual([])
  })

  it('emits an import for a $ref inside patternProperties', () => {
    const schema: JSONSchema = {
      type: 'object',
      patternProperties: { '^x-': { $ref: '#/$defs/foo' } },
    }
    const code = generateExampleFile(schema, 'PatternProps', { rootSchema })
    expect(code).toContain("from './foo.js'")
    expect(compileErrors(code)).toEqual([])
  })
})
