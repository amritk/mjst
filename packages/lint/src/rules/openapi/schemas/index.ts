import { createRequire } from 'node:module'

// The OpenAPI structural meta-schemas are the official JSON Schema documents
// from spec.openapis.org, kept as raw `.json` files in this directory (see
// `README.md` for the exact source URLs, dates, and the one adaptation the 2.0
// schema needs). They are loaded with `require` rather than a static JSON import
// so the emitted ESM stays valid without an import attribute, and the build
// copies the `.json` files next to the compiled output. 3.1/3.2 express Schema
// Objects as JSON Schema 2020-12 via a local `$dynamicRef`, which
// @amritk/runtime-validators resolves natively — no bundling, no dialect engine.
const require = createRequire(import.meta.url)

/** Official Swagger 2.0 schema, with its external draft-04 metaschema refs inlined. */
export const oas2Schema: object = require('./oas20.json')
/** Official OpenAPI 3.0 schema (draft-04), consumed verbatim. */
export const oas3Schema: object = require('./oas30.json')
/** Official, self-contained OpenAPI 3.1 schema (2020-12), consumed verbatim. */
export const oas31Schema: object = require('./oas31.json')
/** Official, self-contained OpenAPI 3.2 schema (2020-12), consumed verbatim. */
export const oas32Schema: object = require('./oas32.json')
