import { refToFilename } from '@amritk/helpers/ref-to-filename'
import { refToName } from '@amritk/helpers/ref-to-name'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { collectEmittedRefs } from './collect-emitted-refs'

/**
 * Options for controlling how validator imports are collected.
 */
type CollectValidatorImportsOptions = {
  /**
   * The $ref path of the schema being generated (e.g. `#/$defs/encoding`).
   * Prevents a file from importing itself.
   */
  readonly selfRef?: string | undefined
  /**
   * The root schema document. URI refs that cannot be resolved within it
   * are excluded from the import list (they were never generated as files).
   */
  readonly rootSchema?: Record<string, unknown> | undefined
  /**
   * Suffix appended to every type/validator name derived from a `$ref`. Must
   * match the suffix used when generating the referenced files. Defaults to `''`.
   */
  readonly typeSuffix?: string
  /**
   * Whether the file being generated reads each half of a `$ref`'s import — the
   * type, the validator, or both.
   *
   * The two halves come apart in both directions. A `$ref` in a position the type
   * generator does not read (an `if` arm, whose whole node it types `unknown`) is
   * called and never named; one in a position only the *type* reads (a tuple's
   * rest, taken from `additionalItems`) is named and never called; and a ref
   * inside a branch that folded away is neither. Importing a half nothing reads
   * leaves it unused, which is `TS6133` in the generated file for any consumer
   * with `noUnusedLocals` — this repo, and anything inheriting its flags.
   *
   * Defaults to "both", which is what every caller wanted before anyone asked the
   * question.
   */
  readonly reads?: (names: { readonly typeName: string; readonly validatorName: string }) => {
    readonly type: boolean
    readonly validator: boolean
  }
}

/**
 * Generates an import statement for a single $ref, importing both the type
 * and the validator function from the ref's generated file.
 */
const buildImport = (ref: string, suffix: string, reads: Reads): string | null => {
  const filename = refToFilename(ref)
  const typeName = refToName(ref, suffix)
  const validatorName = `validate${typeName}`
  const { type, validator } = reads({ typeName, validatorName })
  // `.js` extension so the emitted import resolves under Node ESM (not just Bun);
  // `./x.js` → sibling `x.ts` is the standard NodeNext form.
  if (type && validator) return `import { type ${typeName}, ${validatorName} } from './${filename}.js'`
  if (validator) return `import { ${validatorName} } from './${filename}.js'`
  if (type) return `import type { ${typeName} } from './${filename}.js'`
  return null
}

/** The question {@link CollectValidatorImportsOptions.reads} answers, named once. */
type Reads = NonNullable<CollectValidatorImportsOptions['reads']>

/**
 * Collects import statements for all $ref dependencies of a schema.
 * Each import brings in both the generated TypeScript type and validator function.
 *
 * @example
 * ```typescript
 * const schema = { properties: { contact: { $ref: '#/$defs/contact' } } }
 * collectValidatorImports(schema)
 * // ["import { type Contact, validateContact } from './contact'"]
 * ```
 */
export const collectValidatorImports = (schema: JSONSchema, options?: CollectValidatorImportsOptions): string[] => {
  const selfFilename = options?.selfRef ? refToFilename(options.selfRef) : null
  const rootSchema = options?.rootSchema
  const typeSuffix = options?.typeSuffix ?? ''
  const reads: Reads = options?.reads ?? (() => ({ type: true, validator: true }))

  // `includeTypeOnly`: the import brings in the type as well as the validator, so
  // it has to cover the positions the *type* generator reads even where the
  // emitter ignores them. `assertGeneratableRefs` asks a narrower question and
  // deliberately does not pass it.
  const refs = collectEmittedRefs(schema, [], rootSchema, true)
  const seen = new Set<string>()
  const imports: string[] = []

  for (const ref of refs) {
    // The ref's own filename, with no rewriting. A `-or-reference` suffix used to
    // be stripped here on the theory that `parameter-or-reference` collapses onto
    // `parameter` — but `walkRefGraph` gives it a file of its own, and the emitter
    // and the type generator both name it in full. The import therefore pointed at
    // the wrong module and brought in the wrong names, leaving `root.ts` calling a
    // `validateParameterOrReference` nothing defined (and, when no base
    // `parameter` def existed, importing a module that was never written). The
    // OpenAPI 3.1 metaschema names definitions exactly this way.
    // `@amritk/generate-parsers` dropped the same rewrite for the same reason.
    const filename = refToFilename(ref)

    if (seen.has(filename)) continue
    if (selfFilename && filename === selfFilename) continue

    // Skip refs that don't resolve in this schema (external / never generated)
    if (rootSchema) {
      const resolved = resolveRef(ref, rootSchema)
      if (!resolved) continue
    }

    const statement = buildImport(ref, typeSuffix, reads)
    // A ref whose file the emitted text neither names nor calls — a branch that
    // folded away took both halves with it — needs no import at all. The filename
    // is still marked seen: a second ref to it would reach the same answer.
    seen.add(filename)
    if (statement !== null) imports.push(statement)
  }

  return imports
}
