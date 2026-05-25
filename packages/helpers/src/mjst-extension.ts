import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { isSchemaObject } from './schema-guards'

/**
 * Vendor extension keyword carrying mjst-specific runtime hints that plain JSON
 * Schema cannot express on its own. Adapters (TypeBox, Zod, ...) emit it when a
 * source construct has no native JSON Schema equivalent, and the generators read
 * it to produce the right TypeScript type and runtime checks.
 */
export const MJST_EXTENSION_KEY = 'x-mjst'

/**
 * The shape of the `x-mjst` extension object.
 *
 * - `instanceOf` names a JavaScript class the value must be an instance of at
 *   runtime (e.g. `'Date'`). It round-trips constructs like TypeBox's
 *   `Type.Date()` that JSON Schema's core vocabulary has no keyword for.
 * - `primitive` names a non-JSON primitive type (e.g. `'bigint'`) that has no
 *   JSON Schema representation. Unlike `instanceOf`, the value is checked with
 *   `typeof`, not `instanceof`.
 * - `brand` carries a nominal-typing brand name. It is purely type-level: the
 *   runtime value still validates as its underlying JSON Schema type, but the
 *   generated TypeScript type is intersected with a unique brand so values are
 *   not interchangeable with the unbranded base type.
 */
export type MjstExtension = {
  readonly instanceOf?: string
  readonly primitive?: string
  readonly brand?: string
}

// Only identifier-safe class names are honoured, so a malicious or malformed
// schema cannot inject arbitrary code into the generated output.
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

// The non-JSON primitives we know how to generate type/runtime handling for.
// Anything outside this set is ignored so unknown hints degrade gracefully.
const SUPPORTED_PRIMITIVES = new Set(['bigint'])

// Brand names are embedded inside a single-quoted string literal in generated
// output, so we only allow characters that cannot break out of the literal.
const SAFE_BRAND = /^[\w$ -]+$/

const readExtensionString = (schema: JSONSchema, field: keyof MjstExtension): string | undefined => {
  if (!isSchemaObject(schema)) return undefined

  const extension = (schema as Record<string, unknown>)[MJST_EXTENSION_KEY]
  if (typeof extension !== 'object' || extension === null) return undefined

  const value = (extension as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : undefined
}

/**
 * Reads the `instanceOf` class name from a schema's `x-mjst` extension, when it
 * is present and a safe identifier. Returns undefined otherwise so callers fall
 * back to ordinary type handling.
 */
export const getMjstInstanceOf = (schema: JSONSchema): string | undefined => {
  const instanceOf = readExtensionString(schema, 'instanceOf')
  return instanceOf !== undefined && IDENTIFIER.test(instanceOf) ? instanceOf : undefined
}

/**
 * Reads the `primitive` type name from a schema's `x-mjst` extension, when it is
 * one we support (e.g. `'bigint'`). Returns undefined otherwise.
 */
export const getMjstPrimitive = (schema: JSONSchema): string | undefined => {
  const primitive = readExtensionString(schema, 'primitive')
  return primitive !== undefined && SUPPORTED_PRIMITIVES.has(primitive) ? primitive : undefined
}

/**
 * Reads the nominal `brand` name from a schema's `x-mjst` extension, when it is
 * present and safe to embed in generated output. Returns undefined otherwise.
 */
export const getMjstBrand = (schema: JSONSchema): string | undefined => {
  const brand = readExtensionString(schema, 'brand')
  return brand !== undefined && SAFE_BRAND.test(brand) ? brand : undefined
}
