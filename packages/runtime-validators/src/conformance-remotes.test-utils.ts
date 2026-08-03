import { loadSuiteRemotes } from '../../../fixtures/json-schema-test-suite/load-suite'
import { metaschema } from './metaschema'

/**
 * The documents the official JSON Schema Test Suite expects a validator to be
 * able to reach while it runs, assembled into the map
 * `ValidateOptions.schemas` takes.
 *
 * The suite ships these as `remotes/`, and its own instructions are to serve
 * them from `http://localhost:1234/` — `remotes/draft2020-12/integer.json` is
 * `http://localhost:1234/draft2020-12/integer.json`, and so on. Every
 * implementation in every language runs `refRemote.json` by making those URIs
 * resolvable one way or another; a harness with an HTTP server does it with a
 * socket, and we do it by handing the already-parsed documents to the public
 * API. Nothing about the measurement changes — the interpreter still has to
 * resolve the base URIs, walk the anchors and get the `$dynamicRef` bookending
 * right across documents — only the retrieval step is answered for it, which is
 * the one thing this package will never do itself.
 *
 * The dialect metaschema goes in alongside them. A few cases (`defs.json`, and
 * `ref.json`'s "remote ref, containing refs itself") validate a schema *against
 * its own dialect* by `$ref`ing `https://json-schema.org/draft/2020-12/schema`,
 * which the suite does not ship in `remotes/` — it assumes a validator knows the
 * dialect it implements. This one does: the documents come from the package's
 * own `@amritk/runtime-validators/metaschema` export, so nothing in the
 * measurement path reaches into another package's internals.
 */
export const loadSuiteDocuments = (): Record<string, unknown> => ({ ...metaschema, ...loadSuiteRemotes() })
