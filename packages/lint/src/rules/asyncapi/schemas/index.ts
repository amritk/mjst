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

// AsyncAPI 3.0 does not merely *allow* a `$ref` in four places — it requires
// one. A channel's `servers`, an operation's `channel` and `messages`, and the
// same pair on an operation reply are all typed as Reference Objects, because
// the spec wants those to be pointers at objects declared once elsewhere.
//
// That makes the published schema unusable against a dereferenced tree: once a
// resolver has inlined those pointers, the very documents the spec calls valid
// stop matching it. The resolved variant widens those positions to "a Reference
// Object *or* the thing it points at", so the resolved pass checks the inlined
// content instead of rejecting the fact that it was inlined — while still
// accepting a `$ref` the resolver deliberately left in place, which
// `@amritk/resolve-refs` does for any chain that would close a cycle. Whatever
// stopped such a ref from resolving is the resolver's to report, not a
// structural error to invent here.
const RESOLVED_3_0_REFERENCES: { definition: string; property: string; items: boolean; target: string }[] = [
  { definition: 'channel', property: 'servers', items: true, target: 'server' },
  { definition: 'operation', property: 'channel', items: false, target: 'channel' },
  { definition: 'operation', property: 'messages', items: true, target: 'messageObject' },
  { definition: 'operationReply', property: 'channel', items: false, target: 'channel' },
  { definition: 'operationReply', property: 'messages', items: true, target: 'messageObject' },
]

const definitionId = (name: string): string => `http://asyncapi.com/definitions/3.0.0/${name}.json`

const resolvedCache = new Map<AsyncApiVersion, object>()

/**
 * The meta-schema to validate a `$ref`-dereferenced document against.
 *
 * Only 3.0 differs from its published form; every other version models a
 * reference as one alternative of a `oneOf`, so an inlined object still
 * matches and the schema is returned unchanged.
 */
export const loadResolvedAsyncApiSchema = (version: AsyncApiVersion): object => {
  if (version !== '3.0') return loadAsyncApiSchema(version)
  let schema = resolvedCache.get(version)
  if (!schema) {
    const patched = structuredClone(loadAsyncApiSchema(version)) as {
      $id?: string
      definitions?: Record<string, { properties?: Record<string, Record<string, unknown>> }>
    }
    // A distinct `$id`, so a validator cache keyed by identity never confuses the
    // two variants of the same version.
    patched.$id = definitionId('asyncapi-resolved')
    const definitions = patched.definitions ?? {}
    for (const { definition, property, items, target } of RESOLVED_3_0_REFERENCES) {
      const owner = Object.hasOwn(definitions, definitionId(definition))
        ? definitions[definitionId(definition)]
        : undefined
      const node = owner?.properties?.[property]
      if (node === undefined) continue
      const slot = items ? (node['items'] as Record<string, unknown> | undefined) : node
      // Only rewrite a slot that is still the Reference Object the published
      // schema puts there. If upstream restructures it, leave it alone rather
      // than widening whatever replaced it.
      if (slot?.['$ref'] !== definitionId('Reference')) continue
      delete slot['$ref']
      slot['anyOf'] = [{ $ref: definitionId('Reference') }, { $ref: definitionId(target) }]
    }
    schema = patched as object
    resolvedCache.set(version, schema)
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
