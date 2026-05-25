import { MJST_EXTENSION_KEY } from '@amritk/helpers/mjst-extension'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

// Minimal structural view of `@valibot/to-json-schema`, so the adapter does not
// hard-depend on its types — the converter is loaded at runtime as an optional
// peer dependency.
type ValibotOverrideContext = { readonly valibotSchema?: { readonly type?: string } }

type ValibotConfig = {
  readonly errorMode?: 'throw' | 'warn' | 'ignore'
  readonly overrideSchema?: (ctx: ValibotOverrideContext) => Record<string, unknown> | undefined
}

type ToJsonSchema = (schema: unknown, config?: ValibotConfig) => Record<string, unknown>

/**
 * Resolves `@valibot/to-json-schema`'s `toJsonSchema` from a runtime import,
 * throwing a clear error when the converter is missing.
 */
const loadToJsonSchema = async (): Promise<ToJsonSchema> => {
  let mod: Record<string, unknown>
  try {
    mod = (await import('@valibot/to-json-schema')) as Record<string, unknown>
  } catch {
    throw new Error(
      "The Valibot adapter requires '@valibot/to-json-schema' (and 'valibot') to be installed in your project.",
    )
  }

  const named = mod['toJsonSchema']
  const fromDefault = (mod['default'] as Record<string, unknown> | undefined)?.['toJsonSchema']
  const converter = typeof named === 'function' ? named : typeof fromDefault === 'function' ? fromDefault : undefined

  if (!converter) {
    throw new Error("'@valibot/to-json-schema' did not export 'toJsonSchema'.")
  }

  return converter as ToJsonSchema
}

/**
 * Converts a Valibot schema into a Draft 2020-12 JSON Schema via
 * `@valibot/to-json-schema`.
 *
 * Valibot's `date` schema has no JSON Schema representation and would otherwise
 * throw, so we run with `errorMode: 'ignore'` (other unsupported constructs
 * degrade to an open schema rather than failing the whole conversion) and use
 * the `overrideSchema` hook to rewrite dates into the shared `x-mjst` instanceOf
 * extension — the same handling TypeBox and Zod dates receive.
 */
export const valibotToJsonSchema = async (source: unknown): Promise<JSONSchema> => {
  if (typeof source !== 'object' || source === null) {
    const received = source === null ? 'null' : typeof source
    throw new Error(`Valibot adapter expected a Valibot schema but received ${received}.`)
  }

  const toJsonSchema = await loadToJsonSchema()

  let json: Record<string, unknown>
  try {
    json = toJsonSchema(source, {
      errorMode: 'ignore',
      overrideSchema: (ctx) =>
        ctx.valibotSchema?.type === 'date' ? { [MJST_EXTENSION_KEY]: { instanceOf: 'Date' } } : undefined,
    })
  } catch (error) {
    throw new Error(`Valibot adapter failed to convert the schema. Is it a valid Valibot schema?\n${String(error)}`)
  }

  // Valibot emits a draft-07 dialect marker; the generators target 2020-12.
  delete json['$schema']

  return json as JSONSchema
}
