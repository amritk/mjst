import { refToFilename } from '@amritk/helpers/ref-to-filename'
import { refToName } from '@amritk/helpers/ref-to-name'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import {
  hasAdditionalProperties,
  hasAllOf,
  hasAnyOf,
  hasContains,
  hasDependentSchemas,
  hasOneOf,
  hasProperties,
  hasRef,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { assertGeneratorDepth } from './assert-generator-depth'

/**
 * Options for controlling how example imports are collected.
 */
type CollectExampleImportsOptions = {
  /**
   * The $ref path of the schema being generated (e.g. `#/$defs/address`).
   * Prevents a file from importing itself.
   */
  readonly selfRef?: string | undefined
  /**
   * The root schema document. URI refs that cannot be resolved within it
   * are excluded from the import list (they were never generated as files).
   */
  readonly rootSchema?: Record<string, unknown> | undefined
  /**
   * Suffix appended to every type/arbitrary name derived from a `$ref`. Must
   * match the suffix used when generating the referenced files. Defaults to `''`.
   */
  readonly typeSuffix?: string
}

/**
 * Generates an import statement for a single $ref, importing both the generated
 * type and its arbitrary from the ref's generated file.
 */
const buildImport = (ref: string, suffix: string): string => {
  const filename = refToFilename(ref)
  const typeName = refToName(ref, suffix)
  // `.js` extension so the emitted import resolves under Node ESM, not only Bun.
  return `import { type ${typeName}, ${typeName}Arbitrary } from './${filename}.js'`
}

/**
 * Recursively collects every `$ref` string reachable through the schema surface
 * that the type and arbitrary generators traverse. A generated file's single
 * import block must cover every ref those generators emit, so this walks the
 * *same* nested surface `arbitraryExpr` (generate-arbitrary.ts) descends into —
 * combinator branches, object `properties`/`patternProperties`/
 * `additionalProperties`/`dependentSchemas`, and array `items`/`prefixItems`
 * (both the single-schema and tuple array forms) plus `contains` — not just the
 * top level. Missing any of these emits a bare `XxxArbitrary` identifier (or a
 * bare `Xxx` type) with no matching import, producing TypeScript that fails to
 * compile.
 *
 * `if`/`then`/`else`/`not`/`propertyNames` are deliberately *not* walked:
 * `arbitraryExpr` never descends into them, so they contribute no identifier to
 * import — a schema using them is reconciled by the embedded validating filter,
 * which carries its `$ref` targets as inlined JSON rather than as imports.
 *
 * `$ref` nodes short-circuit (matching `arbitraryExpr`, which resolves a `$ref`
 * and ignores sibling keywords), so recursion is bounded by the schema's own
 * structural nesting and cannot loop on a self-referential ref.
 */
const collectRefs = (schema: JSONSchema, depth = 0): string[] => {
  // The same cap the arbitrary and the deriver honour. This walk is cheaper per
  // level, so it survives deeper — but a document the other two refuse is one
  // this package cannot generate anyway, and dying here with a bare `RangeError`
  // would only bury the real message.
  assertGeneratorDepth(depth, 'collectExampleImports')
  if (!isSchemaObject(schema)) return []
  if (hasRef(schema)) return [schema.$ref]

  const refs: string[] = []
  const visit = (sub: JSONSchema): void => {
    refs.push(...collectRefs(sub, depth + 1))
  }

  if (hasOneOf(schema)) schema.oneOf.forEach(visit)
  if (hasAnyOf(schema)) schema.anyOf.forEach(visit)
  if (hasAllOf(schema)) schema.allOf.forEach(visit)

  if (hasProperties(schema)) Object.values(schema.properties).forEach(visit)

  const raw = schema as Record<string, unknown>

  const patternProperties = raw['patternProperties']
  if (typeof patternProperties === 'object' && patternProperties !== null) {
    Object.values(patternProperties as Record<string, JSONSchema>).forEach(visit)
  }

  if (hasAdditionalProperties(schema) && isSchemaObject(schema.additionalProperties as JSONSchema)) {
    visit(schema.additionalProperties as JSONSchema)
  }

  // `objectExpr` folds each `dependentSchemas` branch's `properties` into the
  // record it builds, so a `$ref` in one becomes a bare identifier in the output.
  if (hasDependentSchemas(schema)) Object.values(schema.dependentSchemas).forEach(visit)

  const prefixItems = raw['prefixItems']
  if (Array.isArray(prefixItems)) (prefixItems as JSONSchema[]).forEach(visit)

  const items = raw['items']
  // `items` is either a tuple (draft-07 array form) or a single item schema.
  if (Array.isArray(items)) (items as JSONSchema[]).forEach(visit)
  else if (isSchemaObject(items as JSONSchema)) visit(items as JSONSchema)

  // With no `items`, `arrayExpr` generates elements straight from `contains`.
  if (hasContains(schema) && isSchemaObject(schema.contains)) visit(schema.contains)

  return refs
}

/**
 * Collects import statements for all $ref dependencies of a schema. Each import
 * brings in both the generated TypeScript type and the arbitrary for that ref.
 *
 * @example
 * ```typescript
 * const schema = { properties: { address: { $ref: '#/$defs/address' } } }
 * collectExampleImports(schema)
 * // ["import { type Address, AddressArbitrary } from './address'"]
 * ```
 */
export const collectExampleImports = (schema: JSONSchema, options?: CollectExampleImportsOptions): string[] => {
  const selfFilename = options?.selfRef ? refToFilename(options.selfRef) : null
  const rootSchema = options?.rootSchema
  const typeSuffix = options?.typeSuffix ?? ''

  const refs = collectRefs(schema)
  const seen = new Set<string>()
  const imports: string[] = []

  for (const ref of refs) {
    const filename = refToFilename(ref)

    if (seen.has(filename)) continue
    if (selfFilename && filename === selfFilename) continue

    // Skip refs that don't resolve in this schema (external / never generated)
    if (rootSchema) {
      const resolved = resolveRef(ref, rootSchema)
      if (!resolved) continue
    }

    seen.add(filename)
    imports.push(buildImport(ref, typeSuffix))
  }

  return imports
}
