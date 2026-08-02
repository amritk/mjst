import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

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
 */
export const loadSuiteDocuments = (): Record<string, unknown> => {
  const documents: Record<string, unknown> = {}
  collectRemotes(REMOTES_DIR, 'http://localhost:1234/draft2020-12', documents)
  collectMetaschema(documents)
  return documents
}

/** Where the suite's `remotes/` tree is vendored, alongside the cases themselves. */
const REMOTES_DIR = new URL('../../../fixtures/json-schema-test-suite/remotes/draft2020-12', import.meta.url).pathname

/**
 * Reads every `.json` under `dir` into `documents`, keyed by the URI the suite
 * would have served it from. Subdirectories keep their path segment, because
 * that is exactly what the `retrieved nested refs resolve relative to their URI
 * not $id` case is testing.
 */
const collectRemotes = (dir: string, prefix: string, documents: Record<string, unknown>): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectRemotes(full, `${prefix}/${entry.name}`, documents)
    else if (entry.name.endsWith('.json')) documents[`${prefix}/${entry.name}`] = JSON.parse(readFileSync(full, 'utf8'))
  }
}

/**
 * Adds the official Draft 2020-12 metaschema and the seven vocabulary
 * metaschemas it is assembled from.
 *
 * A few suite cases (`defs.json`, and `ref.json`'s "remote ref, containing refs
 * itself") validate a schema *against its own dialect*, which means `$ref`ing
 * `https://json-schema.org/draft/2020-12/schema`. The suite does not ship that
 * document in `remotes/` — it assumes a validator knows the dialect it
 * implements — so a harness has to bring its own copy. Ajv is already this
 * package's differential oracle and vendors the specification text verbatim, so
 * we read it from there rather than keeping a second copy in sync.
 */
const collectMetaschema = (documents: Record<string, unknown>): void => {
  const require = createRequire(import.meta.url)
  const schemaPath = require.resolve('ajv/dist/refs/json-schema-2020-12/schema.json')
  documents['https://json-schema.org/draft/2020-12/schema'] = JSON.parse(readFileSync(schemaPath, 'utf8'))

  const metaDir = join(schemaPath, '..', 'meta')
  for (const entry of readdirSync(metaDir).sort()) {
    if (!entry.endsWith('.json')) continue
    const name = entry.slice(0, -'.json'.length)
    documents[`https://json-schema.org/draft/2020-12/meta/${name}`] = JSON.parse(
      readFileSync(join(metaDir, entry), 'utf8'),
    )
  }
}
