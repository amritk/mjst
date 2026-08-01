import type { ResolveError } from './types'

/**
 * How deep either resolver walks before it gives up on a branch.
 *
 * Both walkers are recursive, so a pathologically nested document (`{"a":{"a":…`
 * repeated thousands of times — trivial to produce, and JSON.parse happily
 * accepts it) used to unwind the whole call stack with a `RangeError`. That
 * broke the package's headline contract: errors are *collected* on the result,
 * never thrown. Capping the walk turns that crash into an ordinary
 * {@link ResolveError} on the result.
 *
 * 512 is far past anything a hand-written or generated schema reaches (deeply
 * bundled OpenAPI documents live around 20–40 levels) while staying comfortably
 * inside the default stack on every runtime we target.
 */
export const DEFAULT_MAX_DEPTH = 512

/**
 * The error recorded when a walk hits {@link DEFAULT_MAX_DEPTH} (or the
 * caller's `maxDepth`). Reported once per resolve — a wide *and* deep document
 * would otherwise push one error per branch and turn the error array into its
 * own memory problem. The offending subtree is left unresolved rather than
 * dropped, so no data disappears silently.
 */
export const depthLimitError = (maxDepth: number): ResolveError => ({
  message: `Document nesting exceeds the maximum depth of ${maxDepth}; the deeper subtrees were left unresolved (raise maxDepth to allow more)`,
  path: [],
})
