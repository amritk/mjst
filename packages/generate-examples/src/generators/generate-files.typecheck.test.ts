import { createRequire } from 'node:module'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { generateExampleFile } from './generate-files'

/**
 * Type-checks generated files against the *real* `fast-check` declarations, under
 * the same compiler flags this repo holds itself to.
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
 * All cases share one `ts.Program`: spinning one up loads the default lib files
 * from disk, and doing that per case is what makes the compile suites slow.
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

const rootSchema = {
  $defs: {
    foo: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
    node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } },
    link: { type: 'object', properties: { next: { $ref: '#/$defs/link' } }, required: ['next'] },
  },
}

/**
 * Every shape the generator can emit that has ever had — or could plausibly
 * develop — an assignability problem between the arbitrary and the type.
 */
const cases: Array<{ name: string; schema: JSONSchema }> = [
  { name: 'enum property', schema: { type: 'object', properties: { en: { enum: ['a', 'b'] } } } },
  { name: 'top-level enum', schema: { enum: ['a', 'b'] } },
  { name: 'numeric enum', schema: { enum: [1, 2, 3] } },
  { name: 'mixed-scalar enum', schema: { enum: ['a', 1, true, null] } },
  { name: 'enum with object members', schema: { enum: [{ x: 1 }, { y: 2 }] } },
  { name: 'enum with array members', schema: { type: 'array', items: { enum: [['a'], ['b']] } } },
  { name: 'enum narrowed by a sibling minLength', schema: { type: 'string', enum: ['a', 'bbbb'], minLength: 2 } },
  { name: 'const', schema: { const: 'x' } },
  {
    name: 'mixed required and optional properties',
    schema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'integer' } }, required: ['a'] },
  },
  {
    name: 'all-required properties',
    schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
  },
  { name: 'dictionary', schema: { type: 'object', additionalProperties: { type: 'integer' } } },
  {
    name: 'declared keys plus an open map',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: { type: 'integer' },
    },
  },
  { name: 'tuple', schema: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'integer' }] } },
  { name: 'unique array', schema: { type: 'array', items: { type: 'string' }, uniqueItems: true } },
  { name: 'oneOf (filtered)', schema: { oneOf: [{ type: 'string' }, { type: 'integer' }] } },
  { name: 'not (filtered)', schema: { type: 'string', not: { const: 'x' } } },
  {
    name: 'if/then/else (filtered)',
    schema: {
      type: 'object',
      properties: { kind: { enum: ['a', 'b'] }, value: { type: 'integer' } },
      required: ['kind'],
      if: { properties: { kind: { const: 'a' } }, required: ['kind'] },
      then: { required: ['value'] },
    },
  },
  { name: 'multi-type', schema: { type: ['string', 'null'] } },
  { name: 'string formats', schema: { type: 'string', format: 'date-time' } },
  { name: 'pattern with length bounds', schema: { type: 'string', pattern: '^[a-z]+$', minLength: 2, maxLength: 8 } },
  { name: '$ref', schema: { type: 'object', properties: { foo: { $ref: '#/$defs/foo' } }, required: ['foo'] } },
  {
    name: 'self-recursive $ref (fc.letrec)',
    schema: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } },
  },
  // A property literally named `__proto__` is the one key that cannot be written
  // as a plain object-literal entry, in the emitted `fc.record` config or in the
  // emitted example value.
  {
    name: '__proto__ property',
    schema: JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"},"ok":{"type":"string"}},"required":["__proto__","ok"]}',
    ) as JSONSchema,
  },
  // The filtered arbitrary deliberately generates a *superset* of the declared
  // type, so its base expression is not always a supertype of it. Every case
  // below produced a `.filter((value): value is T => …)` whose predicate
  // TypeScript rejected outright (TS2677).
  {
    name: 'dependentRequired promoting an optional key',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' }, c: { type: 'number' } },
      required: ['a'],
      dependentRequired: { a: ['c'] },
    },
  },
  {
    name: 'dependentSchemas adding a property',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      dependentSchemas: { a: { properties: { z: { type: 'number' } }, required: ['z'] } },
    },
  },
  { name: 'contains without items', schema: { type: 'array', contains: { type: 'number' } } },
  {
    name: 'contains alongside a prefixItems tuple',
    schema: { type: 'array', prefixItems: [{ type: 'string' }], contains: { type: 'number' } },
  },
  {
    name: 'contains alongside items',
    schema: { type: 'array', items: { type: 'string' }, contains: { type: 'number' }, minContains: 2 },
  },
  {
    name: 'required key absent from properties, with a filter keyword',
    schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'b'], minProperties: 2 },
  },
  // OpenAPI documents omit `type: object` / `type: array` constantly, and the
  // type generator infers the shape from `properties`/`items` — so the arbitrary
  // and the example have to infer it too, or they answer `fc.anything()`/`null`
  // to a type that says otherwise.
  {
    name: 'properties without an explicit type',
    schema: { properties: { a: { type: 'string' } }, required: ['a'] } as JSONSchema,
  },
  { name: 'items without an explicit type', schema: { items: { type: 'string' } } as JSONSchema },
  {
    name: 'anyOf branches without an explicit type',
    schema: { anyOf: [{ properties: { a: { type: 'string' } }, required: ['a'] }, { type: 'string' }] } as JSONSchema,
  },
  // A recursive definition's example has to cut the cycle somewhere, and the
  // `null` it cuts with is not a member of the non-nullable declared type.
  {
    name: 'recursive $ref with a required back-edge',
    schema: { type: 'object', properties: { next: { $ref: '#/$defs/link' } }, required: ['next'] },
  },
  // `1e999` is legal JSON that parses to `Infinity`; the derived number came out
  // `NaN`, which `serializeValue` renders as `null`.
  {
    name: 'non-finite multipleOf',
    schema: JSON.parse('{"type":"number","multipleOf":1e999}') as JSONSchema,
  },
  {
    name: 'non-string required entry',
    schema: JSON.parse('{"type":"object","properties":{"a":{"type":"string"}},"required":[1]}') as JSONSchema,
  },
  // `oneOf`/`anyOf` is a constraint *alongside* the node's own keywords, not a
  // replacement for them. Taking the branch alone threw away the node's `type`
  // and `properties` and answered `null` / `fc.anything()`.
  {
    name: 'anyOf beside the node’s own type and properties',
    schema: { type: 'object', properties: { a: { type: 'string' } }, anyOf: [{ required: ['a'] }] },
  },
  {
    name: 'oneOf beside the node’s own type and properties',
    schema: { type: 'object', properties: { a: { type: 'string' } }, oneOf: [{ required: ['a'] }] },
  },
  {
    name: 'allOf branch narrowing a property that carries anyOf',
    schema: {
      allOf: [
        { type: 'object', properties: { x: { anyOf: [{ type: 'integer' }, { type: 'null' }] } } },
        { type: 'object', properties: { x: { type: 'integer' } } },
      ],
    },
  },
  // The type generator calls a schema object-like on `'patternProperties' in
  // schema` — the *key*, whatever its value — and on `properties` regardless of
  // what `type` says. Both generators have to agree with it or the file breaks.
  { name: 'non-object patternProperties', schema: JSON.parse('{"patternProperties":null}') as JSONSchema },
  { name: 'string-valued patternProperties', schema: JSON.parse('{"patternProperties":"x"}') as JSONSchema },
  {
    name: 'properties beside a scalar type',
    schema: { type: 'string', properties: { a: { type: 'string' } } } as JSONSchema,
  },
  {
    name: 'properties beside an array type',
    schema: { type: 'array', properties: { a: { type: 'string' } }, items: { type: 'string' } } as JSONSchema,
  },
  // The type generator folds `if`/`then` properties in as required; the deriver
  // produces none of them, so the literal needs an assertion.
  {
    name: 'if/then-only object',
    schema: { if: { properties: { a: { const: 'x' } } }, then: { properties: { b: { type: 'string' } } } },
  },
  // The boolean `false` schema admits no value at all, so its type is `never`.
  { name: 'boolean false schema', schema: false },
]

/** The repo's own flags — `strict` alone hides two of the failures we care about. */
const COMPILER_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.esnext.d.ts'],
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  noImplicitOverride: true,
  noFallthroughCasesInSwitch: true,
  useUnknownInCatchVariables: true,
  noEmit: true,
  skipLibCheck: true,
  // The bundled `import { type X, XArbitrary }` deliberately brings in both
  // halves even when only one side is referenced, so unused locals are expected.
  noUnusedLocals: false,
}

/** Type-checks every case in one program and returns its error messages per case. */
const checkAllCases = (): Map<string, string[]> => {
  const files: Record<string, string> = { [RUNTIME_VALIDATORS_DTS]: RUNTIME_VALIDATORS_STUB }
  const moduleMap: Record<string, string> = {
    'fast-check': fastCheckTypes(),
    '@amritk/runtime-validators': RUNTIME_VALIDATORS_DTS,
  }
  const entryFor = new Map<string, string>()

  cases.forEach(({ name, schema }, index) => {
    const code = generateExampleFile(schema, `Sample${index}`, { rootSchema })
    const entry = `${VFS_DIR}/case-${index}.ts`
    files[entry] = code
    entryFor.set(name, entry)
    for (const { module, bindings } of parseRefImports(code)) {
      // './foo.js' → /vfs/foo.ts
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
      // Anything else is `fast-check` resolving its own relative declarations —
      // hand those back to the real resolver, or the whole namespace comes back
      // empty and every `fc.*` reads as a missing property.
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

  const byCase = new Map<string, string[]>()
  for (const [name, entry] of entryFor) byCase.set(name, errorsByFile.get(entry) ?? [])
  return byCase
}

const errors = checkAllCases()

describe('generate-files type-checks under the repo strict flags', () => {
  for (const { name } of cases) {
    it(`compiles clean: ${name}`, () => {
      expect(errors.get(name), `${name}\n${(errors.get(name) ?? []).join('\n')}`).toEqual([])
    })
  }
})
