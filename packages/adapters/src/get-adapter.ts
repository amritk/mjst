import type { Adapter } from './adapter'
import type { SourceFormat } from './source-format'
import { typeboxToJsonSchema } from './typebox-to-json-schema'

const typeboxAdapter: Adapter = {
  format: 'typebox',
  toJSONSchema: typeboxToJsonSchema,
}

/**
 * Resolves the adapter for a non-JSON source format.
 *
 * Only formats with an implemented adapter resolve. The `'json'` format never
 * reaches here — the CLI reads JSON Schema files directly without an adapter —
 * and formats that are named but not yet built throw a clear, actionable error
 * so the CLI can fail fast with guidance instead of a cryptic crash.
 */
export const getAdapter = (format: SourceFormat): Adapter => {
  switch (format) {
    case 'typebox':
      return typeboxAdapter
    default:
      throw new Error(
        `No adapter is available for input format '${format}' yet. ` +
          `Supported today: 'typebox'. Use --input json for plain JSON Schema files.`,
      )
  }
}
