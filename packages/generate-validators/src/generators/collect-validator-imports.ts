import { refToFilename } from '@amritk/helpers/ref-to-filename'
import { refToName } from '@amritk/helpers/ref-to-name'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import { hasRef } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

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
 * Recursively walks a schema and yields every `$ref` the validator emitter can
 * turn into a `validateX(...)` call, in traversal order. The emitter recurses
 * into far more than properties/items/additionalProperties/top-level
 * combinators: it also delegates for `patternProperties`, `propertyNames`,
 * `if`/`then`/`else`, `contains`, `prefixItems`, `dependentSchemas`, `not`, and
 * objects nested inside any combinator branch. A `$ref` reached by *any* of those
 * paths must become an import, or the generated file references an undefined
 * `validateX`. (Mirrors the parsers package's `collect-imports` traversal.)
 */
const collectDirectRefs = (value: unknown, refs: string[] = []): string[] => {
  if (typeof value !== 'object' || value === null) return refs

  if (Array.isArray(value)) {
    for (const item of value) collectDirectRefs(item, refs)
    return refs
  }

  const schema = value as Record<string, unknown>

  // A `$ref` is a leaf: the emitter delegates the whole value to the referenced
  // validator, so record the ref and do not descend past it.
  if (hasRef(schema)) {
    refs.push(schema.$ref as string)
    return refs
  }

  // Every keyword whose subschema(s) the emitter recurses into. `properties` and
  // `patternProperties` hold subschemas as object *values*; the combinator/tuple
  // keywords hold them in arrays; the rest are single subschemas. We deliberately
  // do NOT descend into `$defs`/`definitions` — those are split into their own
  // generated files, not inlined by this validator. `collectDirectRefs`
  // self-guards on non-objects, so a keyword that is a boolean or missing is a
  // harmless no-op.
  const subSchemaMaps = ['properties', 'patternProperties']
  for (const mapKey of subSchemaMaps) {
    const map = schema[mapKey]
    if (typeof map === 'object' && map !== null && !Array.isArray(map)) {
      for (const sub of Object.values(map)) collectDirectRefs(sub, refs)
    }
  }

  const singleSubSchemas = ['items', 'additionalProperties', 'propertyNames', 'contains', 'if', 'then', 'else', 'not']
  for (const key of singleSubSchemas) {
    if (key in schema) collectDirectRefs(schema[key], refs)
  }

  const arraySubSchemas = ['oneOf', 'anyOf', 'allOf', 'prefixItems']
  for (const key of arraySubSchemas) {
    const arr = schema[key]
    if (Array.isArray(arr)) {
      for (const sub of arr) collectDirectRefs(sub, refs)
    }
  }

  return refs
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

  const refs = collectDirectRefs(schema)
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
