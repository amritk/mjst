import { createRequire } from 'node:module'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import ts from 'typescript'
import { expect, it } from 'vitest'

import { loadComponentSchemas } from '../../../../fixtures/openapi/load-fixtures'
import { generateExampleFile } from './generate-files'

/**
 * Type-checks a generated file for *every* schema in the vendored OpenAPI corpus
 * against the real `fast-check` declarations, under the repo's strict flags.
 *
 * The hand-written cases in `generate-files.typecheck.test.ts` cover shapes we
 * thought to write down. This covers the ones real documents actually contain:
 * an adversarial sweep once put 13% of these schemas in the "does not compile"
 * bucket, and every distinct cause it surfaced — a filtered arbitrary whose base
 * is not a supertype, `properties` without `type: object`, a `oneOf` branch
 * wrapped in its own `allOf` — was invisible to the curated list. A single
 * `ts.Program` over the whole corpus is the only check that keeps finding them.
 *
 * The sibling `collect-example-imports.compile.test.ts` stubs `fast-check` with
 * combinators that all return `Arbitrary<any>`, which is exactly why it could
 * only prove that identifiers resolve. Every assignability bug slipped past it:
 * `fc.constantFrom("a", "b")` widens to `Arbitrary<string>` and does not fit the
 * `"a" | "b"` the generated type declares, so *any* schema with an `enum`
 * property produced a file no consumer on a strict tsconfig could compile. Real
 * declarations are the only way to catch that class of defect, so this suite
 * pays for them.
 *
 * Cases are type-checked in batches rather than one program per case: spinning a
 * program up loads the default lib files from disk, and doing that a thousand
 * times over is what makes a compile suite slow. One program for the *whole*
 * corpus is the other extreme — it holds every source file and its checker state
 * live at once. Batching amortizes the lib loading either way while capping what
 * is resident at any moment, and measured faster than the single-program form
 * (~25s against ~38s), presumably because the checker stays in a smaller working
 * set. Coverage is identical: every schema is still compiled.
 */

const require_ = createRequire(import.meta.url)

/** The `.d.ts` entry point of the installed `fast-check`, from its own manifest. */
const fastCheckTypes = (): string => {
  const manifestPath = require_.resolve('fast-check/package.json')
  const manifest = require_('fast-check/package.json') as {
    types?: string
    exports?: { '.'?: { import?: { types?: string } } }
  }
  const relative = manifest.exports?.['.']?.import?.types ?? manifest.types
  if (relative === undefined) throw new Error('fast-check declares no type entry point')
  return new URL(relative, new URL(`file://${manifestPath}`)).pathname
}

/**
 * A `@amritk/runtime-validators` stand-in with the real `validate` signature.
 * Deliberately not `any`: the generated filter reads `validator(value) === true`,
 * and only a typed return proves that comparison is legal.
 */
const RUNTIME_VALIDATORS_STUB = `
export declare const validate: (schema: unknown) => (input: unknown) => true | { valid: false; errors: unknown[] }
`

const VFS_DIR = '/vfs'
const RUNTIME_VALIDATORS_DTS = `${VFS_DIR}/runtime-validators.d.ts`

/** Bare specifiers resolved to real or stubbed declarations rather than `$ref` modules. */
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
        .map((binding) => binding.trim())
        .filter(Boolean),
    }))

/**
 * A stub module for one `$ref` dependency. Values are declared with real types
 * (an `Arbitrary`, not `any`) so a mistyped reference to a `$ref`'s arbitrary
 * still fails here rather than being absorbed by `any`.
 */
const stubForBindings = (bindings: string[]): string =>
  [
    `import type { Arbitrary } from 'fast-check'`,
    ...bindings.map((binding) => {
      if (binding.startsWith('type ')) return `export type ${binding.slice('type '.length)} = unknown`
      if (binding.endsWith('Arbitrary')) return `export declare const ${binding}: Arbitrary<unknown>`
      return `export declare const ${binding}: unknown`
    }),
  ].join('\n')

const COMPILER_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.esnext.d.ts'],
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  noEmit: true,
  skipLibCheck: true,
  noUnusedLocals: false,
}

/** Every `components.schemas` entry in the vendored corpus, labelled by document. */
const corpusEntries = (): Array<{ label: string; schema: JSONSchema }> =>
  loadComponentSchemas().flatMap(({ fixture, schemas }) =>
    schemas.map(({ name, schema }) => ({ label: `${fixture}#${name}`, schema: schema as JSONSchema })),
  )

/**
 * How many corpus schemas share one `ts.Program`. Sized so the resident set stays
 * modest on a small CI runner while the default lib files are still loaded once
 * per batch rather than once per schema.
 */
const BATCH_SIZE = 150

/** Type-checks one batch and returns a `label: errors` line for each case that fails. */
const checkBatch = (batch: Array<{ label: string; schema: JSONSchema }>, offset: number): string[] => {
  const files: Record<string, string> = { [RUNTIME_VALIDATORS_DTS]: RUNTIME_VALIDATORS_STUB }
  const moduleMap: Record<string, string> = {
    'fast-check': fastCheckTypes(),
    '@amritk/runtime-validators': RUNTIME_VALIDATORS_DTS,
  }
  const entryFor = new Map<string, string>()
  const failures: string[] = []

  batch.forEach(({ label, schema }, localIndex) => {
    const index = offset + localIndex
    let code: string
    try {
      code = generateExampleFile(schema, `Corpus${index}`)
    } catch (error) {
      failures.push(`${label} threw: ${(error as Error).message}`)
      return
    }
    const entry = `${VFS_DIR}/corpus-${index}.ts`
    files[entry] = code
    entryFor.set(label, entry)
    for (const { module, bindings } of parseRefImports(code)) {
      const stem = module.replace(/^\.\//, '').replace(/\.js$/, '')
      const path = `${VFS_DIR}/${stem}.ts`
      files[path] = stubForBindings(bindings)
      moduleMap[module] = path
    }
  })

  const host = ts.createCompilerHost(COMPILER_OPTIONS)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const contents = files[fileName]
    return contents !== undefined
      ? ts.createSourceFile(fileName, contents, languageVersion, true)
      : originalGetSourceFile(fileName, languageVersion, onError, shouldCreate)
  }
  host.fileExists = (fileName) => fileName in files || ts.sys.fileExists(fileName)
  host.readFile = (fileName) => files[fileName] ?? ts.sys.readFile(fileName)
  host.resolveModuleNames = (moduleNames, containingFile) =>
    moduleNames.map((name) => {
      const resolvedFileName = moduleMap[name]
      if (resolvedFileName) return { resolvedFileName }
      return ts.resolveModuleName(name, containingFile, COMPILER_OPTIONS, host).resolvedModule
    })

  const program = ts.createProgram(Object.keys(files), COMPILER_OPTIONS, host)
  const errorsByFile = new Map<string, string[]>()
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue
    const fileName = diagnostic.file?.fileName ?? '(global)'
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' | ')
    errorsByFile.set(fileName, [...(errorsByFile.get(fileName) ?? []), message])
  }

  for (const [label, entry] of entryFor) {
    const errors = errorsByFile.get(entry) ?? []
    if (errors.length > 0) failures.push(`${label}: ${errors.join(' | ')}`)
  }
  return failures
}

it('every corpus schema generates a file that type-checks', { timeout: 600_000 }, () => {
  const entries = corpusEntries()
  expect(entries.length).toBeGreaterThan(500)

  const failures: string[] = []
  for (let offset = 0; offset < entries.length; offset += BATCH_SIZE) {
    failures.push(...checkBatch(entries.slice(offset, offset + BATCH_SIZE), offset))
  }

  expect(failures).toEqual([])
})
