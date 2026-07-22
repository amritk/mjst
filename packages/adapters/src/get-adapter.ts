import type { Adapter } from './adapter'
import { effectToJsonSchema } from './effect-to-json-schema'
import type { SourceFormat } from './source-format'
import { typeboxToJsonSchema } from './typebox-to-json-schema'
import { valibotToJsonSchema } from './valibot-to-json-schema'
import { zodToJsonSchema } from './zod-to-json-schema'

const typeboxAdapter: Adapter = {
  format: 'typebox',
  toJSONSchema: typeboxToJsonSchema,
}

const zodAdapter: Adapter = {
  format: 'zod',
  toJSONSchema: zodToJsonSchema,
}

const valibotAdapter: Adapter = {
  format: 'valibot',
  toJSONSchema: valibotToJsonSchema,
}

const effectAdapter: Adapter = {
  format: 'effect',
  toJSONSchema: effectToJsonSchema,
}

/**
 * Resolves the adapter for a non-JSON source format.
 *
 * Only formats with an implemented adapter resolve. The `'json'` format never
 * reaches here — the CLI reads JSON Schema files directly without an adapter —
 * and formats that are named but not yet built throw a clear, actionable error
 * so the CLI can fail fast with guidance instead of a cryptic crash.
 *
 * @example
 * ```ts
 * import { z } from 'zod' // Zod 4+
 * const User = z.object({ id: z.number().int(), name: z.string().min(1) })
 * const adapter = getAdapter('zod')
 * const jsonSchema = await adapter.toJSONSchema(User) // always await, even for TypeBox
 * // getAdapter('json') THROWS — JSON Schema is read directly, it has no adapter.
 * ```
 */
export const getAdapter = (format: SourceFormat): Adapter => {
  switch (format) {
    case 'typebox':
      return typeboxAdapter
    case 'zod':
      return zodAdapter
    case 'valibot':
      return valibotAdapter
    case 'effect':
      return effectAdapter
    default:
      throw new Error(
        `No adapter is available for input format '${format}'. ` +
          `Supported: 'typebox', 'zod', 'valibot', 'effect'. Use --input json for plain JSON Schema files.`,
      )
  }
}
