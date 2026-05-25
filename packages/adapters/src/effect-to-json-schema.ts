import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

// Minimal structural view of `effect`'s `JSONSchema.make`, loaded at runtime so
// `effect` stays an optional peer dependency.
type Make = (schema: unknown) => Record<string, unknown>

/**
 * Resolves `effect`'s `JSONSchema.make` from a runtime import, throwing a clear
 * error when it is missing.
 */
const loadMake = async (): Promise<Make> => {
  let mod: Record<string, unknown>
  try {
    mod = (await import('effect')) as Record<string, unknown>
  } catch {
    throw new Error("The Effect adapter requires 'effect' to be installed in your project.")
  }

  const jsonSchema = mod['JSONSchema'] as Record<string, unknown> | undefined
  const make = jsonSchema?.['make']

  if (typeof make !== 'function') {
    throw new Error("Effect's 'JSONSchema.make' was not found. The Effect adapter requires effect v3 or later.")
  }

  return make as Make
}

/**
 * Converts an Effect `Schema` into a JSON Schema via `JSONSchema.make`.
 *
 * Effect models values as a decode/encode pair, so `JSONSchema.make` describes
 * the *encoded* (wire) representation. For example `Schema.Date` decodes from a
 * string, so it converts to a string schema rather than a runtime `Date`. We
 * pass that representation straight through — it accurately reflects what Effect
 * expects on the wire — only stripping the dialect marker.
 */
export const effectToJsonSchema = async (source: unknown): Promise<JSONSchema> => {
  // Effect `Schema` values are callable, so they report as `function`, not `object`.
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    const received = source === null ? 'null' : typeof source
    throw new Error(`Effect adapter expected an Effect Schema but received ${received}.`)
  }

  const make = await loadMake()

  let json: Record<string, unknown>
  try {
    json = make(source)
  } catch (error) {
    throw new Error(`Effect adapter failed to convert the schema. Is it a valid Effect Schema?\n${String(error)}`)
  }

  delete json['$schema']

  return json as JSONSchema
}
