/**
 * The two keyword sets every schema walk in this package shares: which keys
 * carry keyword meaning, and which introduce a map of author-chosen names where
 * they do not.
 *
 * The pattern screen, the `$id` registry and the `$anchor` search all walk the
 * same documents and all have to answer the same question, so they read the same
 * two sets from here. They used to restate them one copy each, and every copy
 * drifted at least once — each time producing the same bug: a definition or
 * property named `default` or `example` silently skipped, so an `$id` under it
 * never registered and a `pattern` under it was never screened.
 *
 * Kept in step by hand with `@amritk/helpers`' `DATA_KEYWORDS`/`SCHEMA_MAPS`:
 * this package takes no `@amritk/*` dependency by design, so the sets are
 * restated rather than imported. The parity test in that package reads this
 * declaration, so a drift fails a test.
 */

/**
 * Keywords whose value is arbitrary *data*, not a subschema. A walk stops at
 * these, because a schema is allowed to carry any JSON there — so
 * `{ const: { pattern: '(a+)+' } }` describes a literal object with a `pattern`
 * property, not a regex the validator will ever compile, and an `$anchor` inside
 * an `enum` member is part of an instance rather than a declaration. `example`
 * is OpenAPI 3.0's singular spelling and belongs with `examples`.
 */
export const DATA_KEYWORDS = new Set(['enum', 'const', 'default', 'examples', 'example'])

/**
 * Keywords whose value is a map of author-chosen names to schemas.
 *
 * Inside one the keys are *names*, so {@link DATA_KEYWORDS} carry no keyword
 * meaning there — a property or definition genuinely called `example` or
 * `default` is ordinary, and skipping its subtree would leave whatever it
 * declares unregistered and unscreened.
 */
export const SCHEMA_MAPS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
  'dependencies',
])
