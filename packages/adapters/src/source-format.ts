/**
 * The schema authoring formats mjst can ingest.
 *
 * `'json'` is the built-in default: a plain JSON Schema file read from disk and
 * handed straight to the generators. `'asyncapi'` is also read from disk — an
 * AsyncAPI 2.x/3.0 document (JSON or YAML) whose message schemas
 * `@amritk/asyncapi` extracts, so it never reaches an adapter either. The
 * others name external libraries whose schemas are first converted to JSON
 * Schema by a matching adapter.
 *
 * A format may appear here before its adapter exists — `getAdapter` is the
 * source of truth for what is actually implemented today.
 */
export type SourceFormat = 'json' | 'typebox' | 'zod' | 'valibot' | 'effect' | 'asyncapi'
