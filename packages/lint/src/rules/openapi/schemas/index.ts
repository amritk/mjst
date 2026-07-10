import { createRequire } from 'node:module'

// The OpenAPI structural meta-schemas are the official JSON Schema documents
// from spec.openapis.org, kept as raw `.json` files in this directory (see
// `README.md` for the exact source URLs, dates, and the one adaptation the 2.0
// schema needs). They are loaded with `require` rather than a static JSON import
// so the emitted ESM stays valid without an import attribute, and the build
// copies the `.json` files next to the compiled output. 3.1/3.2 express Schema
// Objects as JSON Schema 2020-12 via a local `$dynamicRef`, which
// @amritk/runtime-validators resolves natively — no bundling, no dialect engine.
//
// Loading is lazy and per-version: nothing is read until `loadOasSchema` is
// called for a given version (which the `oasSchema` rule function only does for
// the document's own OpenAPI version, since each `*-schema` rule is format-gated
// to a single version). Linting a 3.1 document therefore never reads the 2.0 /
// 3.0 / 3.2 schema files.
const require = createRequire(import.meta.url)

/** The OpenAPI versions with a bundled structural meta-schema. */
export type OasVersion = '2.0' | '3.0' | '3.1' | '3.2'

const SCHEMA_FILES: Record<OasVersion, string> = {
  '2.0': './oas20.json',
  '3.0': './oas30.json',
  '3.1': './oas31.json',
  '3.2': './oas32.json',
}

const cache = new Map<OasVersion, object>()

/**
 * Lazily loads (and memoizes) the official structural meta-schema for one
 * OpenAPI version. The returned object is stable across calls, so downstream
 * validator caches (keyed by schema identity) stay warm.
 */
export const loadOasSchema = (version: OasVersion): object => {
  let schema = cache.get(version)
  if (!schema) {
    schema = require(SCHEMA_FILES[version]) as object
    cache.set(version, schema)
  }
  return schema
}
