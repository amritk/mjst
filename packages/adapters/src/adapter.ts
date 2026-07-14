import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import type { SourceFormat } from './source-format'

/**
 * Options that tune how an adapter handles source constructs with no JSON
 * Schema representation. Only the Zod and Valibot adapters read these today;
 * adapters that ignore the argument simply keep their default behaviour.
 */
export type AdapterOptions = {
  /**
   * When `true`, a construct that cannot be fully represented in JSON Schema
   * throws instead of silently widening the generated type. Defaults to `false`,
   * where such constructs are widened and reported with a single batched warning.
   */
  readonly strict?: boolean
}

/**
 * Converts a schema authored in some external library into a Draft 2020-12
 * JSON Schema, which is the single input shape the mjst generators understand.
 *
 * Adapters receive the already-loaded schema value (an imported module export),
 * not a file path. Loading the module is the caller's job so adapters stay pure
 * and trivial to unit test. When a source construct cannot be represented in
 * JSON Schema, adapters should warn and continue on a best-effort basis rather
 * than throw, so generation is not blocked by a single unsupported field — unless
 * the caller opts into `{ strict: true }`.
 */
export type Adapter = {
  /** The source format this adapter handles, matching the `--input` CLI flag. */
  readonly format: SourceFormat
  /**
   * Convert a loaded source schema value into a JSON Schema. May be async:
   * some adapters (e.g. Zod) dynamically import their source library to perform
   * the conversion, so callers should always `await` the result.
   */
  readonly toJSONSchema: (source: unknown, options?: AdapterOptions) => JSONSchema | Promise<JSONSchema>
}
