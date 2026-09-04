import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { buildValidatorSchema } from './build-schema'

/**
 * Pins the shape of every *runtime* export the generator writes: a plain
 * declaration (`export const validateFoo = …`), never a re-export
 * (`export { validateFoo } from './foo.js'`).
 *
 * The two are interchangeable under ESM, so the difference only shows up once
 * the output is consumed as CommonJS — which is how the published benchmark
 * harnesses, and plenty of consumers, load it. TypeScript lowers a re-export to
 * `Object.defineProperty(exports, 'validateFoo', { get() { … } })`, and a bundler
 * emitting CJS does the same for its whole export table. An accessor on
 * `module.exports` is not a monomorphic property load: a caller reaching the
 * function through the module object (`mod.validateFoo(input)`) pays a getter
 * call per invocation, and once a second export in the same process makes that
 * access site polymorphic, the inline cache goes megamorphic and the call falls
 * off a cliff — measurably, ~50% on a hot validator. A plain `export const`
 * lowers to `exports.validateFoo = validateFoo`, a data property, which costs
 * nothing.
 *
 * Type-only re-exports are fine and deliberately allowed: a type cannot be
 * aliased through a `const`, and `export type { … } from` emits no runtime code
 * at all.
 */
const runtimeReExports = (filename: string, content: string): string[] => {
  const source = ts.createSourceFile(filename, content, ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS)

  return source.statements
    .filter((statement): statement is ts.ExportDeclaration => ts.isExportDeclaration(statement))
    .filter((statement) => statement.moduleSpecifier !== undefined && !statement.isTypeOnly)
    .filter((statement) => {
      const clause = statement.exportClause
      // `export * from './x.js'` re-exports whatever the target has, values
      // included, and lowers to `__exportStar` — accessors for every name.
      if (clause === undefined || !ts.isNamedExports(clause)) return true
      return !clause.elements.every((element) => element.isTypeOnly)
    })
    .map((statement) => statement.getText(source))
}

/** Every runtime re-export across a whole build, tagged with the file it came from. */
const runtimeReExportsIn = (files: readonly { filename: string; content: string }[]): string[] =>
  files.flatMap((file) => runtimeReExports(file.filename, file.content).map((text) => `${file.filename}: ${text}`))

/** A multi-file build: two `$ref` definitions plus the root, so the barrel has real work to do. */
const refSchema: JSONSchema = {
  type: 'object',
  properties: {
    contact: { $ref: '#/$defs/contact' },
    address: { $ref: '#/$defs/address' },
  },
  required: ['contact'],
  $defs: {
    contact: {
      type: 'object',
      properties: { name: { type: 'string' }, email: { type: 'string' } },
      required: ['name'],
    },
    address: {
      type: 'object',
      properties: { street: { type: 'string' }, city: { type: 'string' } },
      required: ['street'],
    },
  },
}

describe('data-property-exports', () => {
  it('emits no runtime re-export anywhere in a multi-file build', async () => {
    const files = await buildValidatorSchema(refSchema, 'Document')

    // The shared runtime contract ships with the output too, so it is covered here.
    expect(files.map((file) => file.filename)).toContain('validation-result.ts')
    expect(runtimeReExportsIn(files)).toEqual([])
  })

  it('re-exports validators from the barrel as const aliases', async () => {
    const files = await buildValidatorSchema(refSchema, 'Document')
    const barrel = files.find((file) => file.filename === 'index.ts')?.content ?? ''

    // The alias carries the module's index in the barrel, so match its shape
    // rather than one particular number.
    expect(barrel).toMatch(/import \{ [^}]*validateContact as validateContact\$\d+[^}]*\} from '\.\/contact\.js';/)
    expect(barrel).toMatch(/export const validateContact = validateContact\$\d+;/)
    expect(barrel).not.toContain('export { validateContact }')
  })

  it('lowers the barrel to data properties under CommonJS', async () => {
    // The end the rule exists for: what tsc actually writes when a consumer
    // compiles the output as CJS. A getter here is the regression.
    const files = await buildValidatorSchema(refSchema, 'Document')
    const barrel = files.find((file) => file.filename === 'index.ts')?.content ?? ''

    const { outputText } = ts.transpileModule(barrel, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    })

    expect(outputText).toContain('exports.validateContact = ')
    expect(outputText).not.toContain('Object.defineProperty(exports, "validateContact"')
  })
})
