import { oas20Json } from './oas20'
import { oas30Json } from './oas30'
import { oas31Json } from './oas31'
import { oas32Json } from './oas32'

// The OpenAPI structural meta-schemas are the official JSON Schema documents
// from spec.openapis.org. The `.json` files in this directory are the vendored
// originals (see `README.md` for the exact source URLs, dates, and the one
// adaptation the 2.0 schema needs); `scripts/generate-schema-modules.mjs` turns
// each one into the sibling `.ts` module imported above, and the build fails if
// the two ever drift apart.
//
// That indirection buys portability. Loading these through
// `createRequire(import.meta.url)` with a computed specifier — what this used to
// do — is invisible to every bundler (bundling this entry point produced a
// 524-byte module that threw `Cannot find module './oas31.json'` when called),
// and `createRequire` does not exist on Workers or Deno at all. A static import
// of a generated module is something every bundler can follow and every runtime
// can run. Import attributes (`with { type: 'json' }`) would also bundle, but
// they need Node >= 20.10 while this package supports Node >= 20.
//
// Each generated module holds its schema as JSON *text*, so importing all four
// costs four string literals. The `JSON.parse` — the part that actually costs
// something — still happens lazily, once per version, on first use. Linting a
// 3.1 document therefore never parses the 2.0 / 3.0 / 3.2 schemas.
//
// 3.1/3.2 express Schema Objects as JSON Schema 2020-12 via a local
// `$dynamicRef`, which @amritk/runtime-validators resolves natively — no
// bundling, no dialect engine.

/** The OpenAPI versions with a bundled structural meta-schema. */
export type OasVersion = '2.0' | '3.0' | '3.1' | '3.2'

const SCHEMA_TEXT: Record<OasVersion, string> = {
  '2.0': oas20Json,
  '3.0': oas30Json,
  '3.1': oas31Json,
  '3.2': oas32Json,
}

const cache = new Map<OasVersion, object>()

/**
 * Parses (and memoizes) the official structural meta-schema for one OpenAPI
 * version. The returned object is stable across calls, so downstream validator
 * caches (keyed by schema identity) stay warm.
 */
export const loadOasSchema = (version: OasVersion): object => {
  let schema = cache.get(version)
  if (!schema) {
    // `version` reaches here from a ruleset's `functionOptions`, so it is not
    // guaranteed to be one of the four we ship. A bare index answered
    // `"toString"` from `String.prototype` and `"9.9"` with `undefined`, and
    // `JSON.parse` then failed with a syntax error naming neither the option nor
    // the versions that do exist.
    const text = Object.hasOwn(SCHEMA_TEXT, version) ? SCHEMA_TEXT[version] : undefined
    if (text === undefined) {
      throw new Error(
        `Unknown OpenAPI version "${version}". Known versions are: ${Object.keys(SCHEMA_TEXT).join(', ')}`,
      )
    }
    schema = JSON.parse(text) as object
    cache.set(version, schema)
  }
  return schema
}
