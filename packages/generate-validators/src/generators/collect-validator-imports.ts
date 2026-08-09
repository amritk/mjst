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
}

/**
 * Generates an import statement for a single $ref, importing both the type
 * and the validator function from the ref's generated file.
 */
const buildImport = (ref: string, suffix: string): string => {
  const filename = refToFilename(ref)
  const typeName = refToName(ref, suffix)
  const validatorName = `validate${typeName}`
  // `.js` extension so the emitted import resolves under Node ESM (not just Bun);
  // `./x.js` → sibling `x.ts` is the standard NodeNext form.
  return `import { type ${typeName}, ${validatorName} } from './${filename}.js'`
}

/**
 * Resolves the canonical filename for a ref, stripping `-or-reference` suffixes
 * so that `#/$defs/parameter-or-reference` maps to `parameter`.
 */
const canonicalFilename = (ref: string): string => {
  const base = ref.endsWith('-or-reference') ? ref.replace('-or-reference', '') : ref
  return refToFilename(base)
}

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

  // `includeTypeOnly`: the import brings in the type as well as the validator, so
  // it has to cover the positions the *type* generator reads even where the
  // emitter ignores them. `assertGeneratableRefs` asks a narrower question and
  // deliberately does not pass it.
  const refs = collectEmittedRefs(schema, [], rootSchema, true)
  const seen = new Set<string>()
  const imports: string[] = []

  for (const ref of refs) {
    const filename = canonicalFilename(ref)

    if (seen.has(filename)) continue
    if (selfFilename && filename === selfFilename) continue

    // Skip refs that don't resolve in this schema (external / never generated)
    if (rootSchema) {
      const resolved = resolveRef(ref, rootSchema)
      if (!resolved) continue
    }

    seen.add(filename)

    // -or-reference unions import the base type's validator
    const importRef = ref.endsWith('-or-reference') ? ref.replace('-or-reference', '') : ref
    imports.push(buildImport(importRef, typeSuffix))
  }

  return imports
}
