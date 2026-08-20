/**
 * How deep a schema may nest before the two generator recursions give up.
 *
 * Lower than `@amritk/helpers`' `MAX_SCHEMA_DEPTH` of 2000, and deliberately so.
 * That cap suits the helpers' walkers, which spend roughly two stack frames per
 * schema level. Building an arbitrary or deriving a value costs far more —
 * `derive` → `deriveBase` → `deriveForType` → `deriveObject` → `derive` is five
 * frames before the next level even starts, plus whatever `needsValidationFilter`
 * adds — so the real stack runs out first: measured, the arbitrary generator dies
 * somewhere between 500 and 1000 levels and the deriver between 1000 and 1500,
 * both well under 2000. A cap the stack beats to the punch is no cap at all.
 *
 * 400 sits inside the range both were measured to handle, with room for a
 * shallower stack than this one, and it is still an order of magnitude past
 * anything a real document nests — hand-written schemas rarely pass ten levels,
 * and generated ones rarely pass fifty.
 */
export const MAX_GENERATOR_DEPTH = 400

/**
 * Throws a message naming the nesting limit once a generator recursion passes it.
 *
 * Call this at the top of each recursive step with the *current* depth. Without
 * it a pathologically nested document — a fuzz case, or a document that lost a
 * closing brace — died with a bare `RangeError: Maximum call stack size exceeded`
 * pointing at whichever helper happened to be deepest, which says nothing about
 * the input that caused it.
 */
export const assertGeneratorDepth = (depth: number, generator: string): void => {
  if (depth > MAX_GENERATOR_DEPTH) {
    throw new Error(
      `Schema nesting exceeds ${MAX_GENERATOR_DEPTH} levels while running ${generator}. ` +
        'Flatten the document (or split the deepest subschema into a $defs entry and $ref it) and try again.',
    )
  }
}
