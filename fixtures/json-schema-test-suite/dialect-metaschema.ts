import { metaschema } from '@amritk/runtime-validators/metaschema'

/**
 * The Draft 2020-12 dialect metaschema, in the shape every `schemas` registry in
 * this repo takes.
 *
 * A few suite cases validate a schema *against its own dialect* — `defs.json`,
 * and `ref.json`'s "remote ref, containing refs itself" — by `$ref`ing
 * `https://json-schema.org/draft/2020-12/schema`. The suite does not ship that
 * document in `remotes/`: it assumes an implementation knows the dialect it
 * implements. These do, so the retrieval step is answered the same way the
 * remotes are, by handing over a document rather than fetching one.
 *
 * It lives beside the corpus rather than in any one package because two
 * conformance suites now want it, and re-exporting the published
 * `@amritk/runtime-validators/metaschema` keeps a single copy — the one
 * `metaschema.test.ts` already holds against Ajv's so it cannot drift. The
 * dependency is declared at the workspace root on purpose: a `packages/*`
 * devDependency would join the workspace graph `scripts/bench-scope.ts` walks
 * and make an interpreter change schedule benchmarks that measure none of it.
 */
export const loadDialectMetaschema = (): Record<string, unknown> => ({ ...metaschema })
