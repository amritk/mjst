/**
 * The schema authoring formats mjst can ingest.
 *
 * `'json'` is the built-in default: a plain JSON Schema file read from disk and
 * handed straight to the generators. The others name external libraries whose
 * schemas are first converted to JSON Schema by a matching adapter.
 *
 * `'avro'` is the odd one out in how it is *loaded*, not converted: an Avro
 * schema is a `.avsc` JSON document rather than a module exporting a value, so
 * the CLI reads and parses it like a JSON Schema file and only then hands it to
 * the adapter. Nothing is imported and no export needs naming.
 *
 * A format may appear here before its adapter exists — `getAdapter` is the
 * source of truth for what is actually implemented today.
 */
export type SourceFormat = 'json' | 'typebox' | 'zod' | 'valibot' | 'effect' | 'avro'
