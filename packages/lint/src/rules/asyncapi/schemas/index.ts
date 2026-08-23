import { aas20Json } from './aas20'
import { aas21Json } from './aas21'
import { aas22Json } from './aas22'
import { aas23Json } from './aas23'
import { aas24Json } from './aas24'
import { aas25Json } from './aas25'
import { aas26Json } from './aas26'
import { aas30Json } from './aas30'

// The AsyncAPI structural meta-schemas are the official JSON Schema documents
// from the asyncapi/spec-json-schemas repository. The `.json` files in this
// directory are the vendored originals (see `README.md` for the exact source
// URLs and the three regex adaptations every one of them carries);
// `scripts/generate-schema-modules.mjs` turns each one into the sibling `.ts`
// module imported above, and the build fails if the two ever drift apart.
//
// The indirection is the same one the OpenAPI schemas use, for the same reason:
// a static import of a generated module is something every bundler can follow
// and every runtime can run, while `createRequire` with a computed specifier is
// invisible to bundlers and missing on Workers and Deno.
//
// Each generated module holds its schema as JSON *text*, so importing all eight
// costs eight string literals. The `JSON.parse` — the part that actually costs
// something — happens lazily, once per version, on first use. Linting a 3.0
// document therefore never parses the seven 2.x schemas.
//
// These are draft-07 documents whose subschemas carry absolute `$id`s and refer
// to each other by those URIs (`http://asyncapi.com/definitions/3.0.0/info.json`)
// rather than by JSON Pointer. Nothing is fetched: every target is an `$id`
// declared inside the same document, which @amritk/runtime-validators resolves
// from its own resource registry.

/** The AsyncAPI versions with a bundled structural meta-schema. */
export type AsyncApiVersion = '2.0' | '2.1' | '2.2' | '2.3' | '2.4' | '2.5' | '2.6' | '3.0'

const SCHEMA_TEXT: Record<AsyncApiVersion, string> = {
  '2.0': aas20Json,
  '2.1': aas21Json,
  '2.2': aas22Json,
  '2.3': aas23Json,
  '2.4': aas24Json,
  '2.5': aas25Json,
  '2.6': aas26Json,
  '3.0': aas30Json,
}

/** The bundled versions, oldest first. `asyncapi-latest-version` reports the last one. */
export const ASYNCAPI_VERSIONS = Object.keys(SCHEMA_TEXT) as AsyncApiVersion[]

/** The newest AsyncAPI release this package ships a meta-schema for, as a full `x.y.z` version. */
export const LATEST_ASYNCAPI_VERSION = '3.0.0'

const cache = new Map<AsyncApiVersion, object>()

/**
 * Parses (and memoizes) the official structural meta-schema for one AsyncAPI
 * version. The returned object is stable across calls, so downstream validator
 * caches (keyed by schema identity) stay warm.
 */
export const loadAsyncApiSchema = (version: AsyncApiVersion): object => {
  let schema = cache.get(version)
  if (!schema) {
    // `version` can reach here from a ruleset's `functionOptions` or from an
    // `asyncapi` field in the document, so it is not guaranteed to be one of the
    // eight we ship. A bare index would answer `"toString"` from
    // `String.prototype` and `"9.9"` with `undefined`, and `JSON.parse` would
    // then fail with a syntax error naming neither the option nor the versions
    // that do exist.
    const text = Object.hasOwn(SCHEMA_TEXT, version) ? SCHEMA_TEXT[version] : undefined
    if (text === undefined) {
      throw new Error(
        `Unknown AsyncAPI version "${version}". Known versions are: ${Object.keys(SCHEMA_TEXT).join(', ')}`,
      )
    }
    schema = JSON.parse(text) as object
    cache.set(version, schema)
  }
  return schema
}

/**
 * Maps a document's `asyncapi` string to the bundled meta-schema version, or
 * `undefined` when no bundled schema covers it. Patch releases share their
 * minor's schema (`2.6.4` → `2.6`), which is how the spec publishes them; an
 * unbundled minor such as a future `2.7.0` returns `undefined` so callers report
 * nothing rather than validating against the wrong version.
 */
export const asyncApiSchemaVersion = (declared: unknown): AsyncApiVersion | undefined => {
  if (typeof declared !== 'string') return undefined
  const minor = /^(\d+\.\d+)(?:\.|$)/.exec(declared)?.[1]
  return minor !== undefined && Object.hasOwn(SCHEMA_TEXT, minor) ? (minor as AsyncApiVersion) : undefined
}
