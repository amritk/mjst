import type { SchemaProperty } from '#types/schema'

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Reads an `x-` extension that is declared as a string. The schema is parsed
 * JSON, not validated, so the declared type is a hope rather than a guarantee —
 * a number here would otherwise reach {@link escapeHtml} and throw a bare
 * `TypeError` naming neither the property nor the file.
 */
export const stringExtension = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

/**
 * The array-valued keywords, defensively. Same rationale as
 * {@link stringExtension}: the schema is parsed, never validated, so `enum: "abc"`
 * or `required: 5` would otherwise reach `.map` / `new Set` and throw a bare
 * `TypeError` naming neither the property nor the file.
 */
export const asArray = <T>(value: readonly T[] | undefined): readonly T[] => (Array.isArray(value) ? value : [])

/**
 * A schema node, defensively. `asArray` guards the container but not its
 * members, so `anyOf: [null]` and `properties: {a: null}` still reached a
 * property read on `null`.
 */
export const asSchema = (value: unknown): SchemaProperty => (isObject(value) ? (value as SchemaProperty) : {})

/**
 * A name → schema map, defensively. Every walk over `properties` reaches it
 * through here so they agree on what counts as a property: `Object.entries` on a
 * string spells its characters, so `properties: "ab"` rendered two rows named
 * `0` and `1` in the table while the column scan saw nothing to put in them.
 */
export const asProperties = (value: unknown): Readonly<Record<string, SchemaProperty>> =>
  isObject(value) ? (value as Readonly<Record<string, SchemaProperty>>) : {}

/** The `description` keyword, defensively. See {@link asArray}. */
export const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * A property that gets a detail table of its own: an object that actually
 * declares fields. Narrowing rather than returning a plain boolean is what lets
 * the callers use `prop.properties` without a second, redundant guard to satisfy
 * the compiler.
 */
export const isObjectWithProperties = (
  prop: SchemaProperty,
): prop is SchemaProperty & { readonly properties: Readonly<Record<string, SchemaProperty>> } =>
  isObject(prop.properties) && Object.keys(prop.properties).length > 0
