/**
 * How deep a schema tree may nest before the walkers give up.
 *
 * Every walker in this package is recursive, so a pathologically nested
 * document (a generated fuzz case, or a hand-rolled document that lost a
 * closing brace) used to die with a bare `RangeError: Maximum call stack size
 * exceeded` somewhere inside a `traverse` frame — a stack trace that says
 * nothing about the input that caused it. The cap sits comfortably below the
 * depth at which the stack actually runs out (~5,000 frames in practice) and
 * far above anything a real JSON Schema reaches, so the only documents it
 * rejects are ones that were going to fail anyway — just with a message that
 * names the problem.
 */
export const MAX_SCHEMA_DEPTH = 2000

/**
 * Throws a message naming the nesting limit once a walker passes it.
 *
 * Call this at the top of each recursive step with the *current* depth. The
 * `walker` label is the traversal that hit the limit, so a report points at the
 * pass that failed rather than at whichever helper happened to be deepest.
 *
 * `limit` defaults to {@link MAX_SCHEMA_DEPTH}, which assumes the walker spends
 * roughly one stack frame per schema level — true of every document walk here.
 * A pass that spends several frames per level runs the stack out before the
 * shared cap is reached, so the cap never fires and the bare `RangeError` comes
 * back; such a pass passes its own lower limit instead, and the message names
 * the limit that actually applied.
 */
export const assertSchemaDepth = (depth: number, walker: string, limit: number = MAX_SCHEMA_DEPTH): void => {
  if (depth > limit) {
    throw new Error(
      `Schema nesting exceeds ${limit} levels while running ${walker}. ` +
        'Flatten the document (or split the deepest subschema into a $defs entry and $ref it) and try again.',
    )
  }
}
