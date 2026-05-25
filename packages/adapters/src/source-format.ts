/**
 * The schema authoring formats mjst can ingest.
 *
 * `'json'` is the built-in default: a plain JSON Schema file read from disk and
 * handed straight to the generators. The others name external libraries whose
 * schemas are first converted to JSON Schema by a matching adapter.
 *
 * A format may appear here before its adapter exists — `getAdapter` is the
 * source of truth for what is actually implemented today.
 */
export type SourceFormat = 'json' | 'typebox' | 'zod' | 'valibot' | 'effect'
