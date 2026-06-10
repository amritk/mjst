/**
 * Default key-count cutoff below which an unknown-key sweep inlines `!==`
 * comparisons instead of a hoisted `Set`. Chosen so typical schema objects stay
 * on the faster inline path while pathologically wide objects fall back to the
 * `Set`'s O(1) lookup.
 */
export const INLINE_KEY_LIMIT = 16

/** The pieces a caller needs to emit an `additionalProperties: false` sweep. */
export type UnknownKeyCheck = {
  /**
   * Declarations to emit once before the sweep — a single hoisted `Set` when the
   * key count exceeds the inline limit, otherwise empty (the inline form is
   * stateless). Each entry is a full statement with no trailing `;` or newline,
   * so callers can punctuate to match their surrounding style.
   */
  readonly declarations: readonly string[]
  /**
   * Builds the boolean expression that is true when `keyVar` is NOT one of the
   * known keys — an inline chain of `!==` comparisons, a `Set.has` miss, or the
   * constant `true` when there are no known keys (every key is undeclared).
   */
  readonly isUnknown: (keyVar: string) => string
}

/**
 * Builds the "is this an undeclared key" test used by `additionalProperties:
 * false` sweeps in the generated parsers and validators.
 *
 * For a small number of known keys V8 evaluates a chain of `!==` string
 * comparisons faster than `Set.has` (which has to hash the string), and the
 * inline form skips the per-module `Set` allocation — the same shape Ajv and
 * TypeBox compile to. Above `inlineLimit` the chain grows long enough that the
 * `Set`'s O(1) lookup wins, so a `Set` named `setName` is hoisted instead.
 *
 * @example
 * const check = unknownKeyCheck(['id', 'name'], '_knownKeys0')
 * check.declarations          // []
 * check.isUnknown('_k')       // '_k !== "id" && _k !== "name"'
 */
export const unknownKeyCheck = (
  knownKeys: readonly string[],
  setName: string,
  inlineLimit: number = INLINE_KEY_LIMIT,
): UnknownKeyCheck => {
  if (knownKeys.length === 0) {
    return { declarations: [], isUnknown: () => 'true' }
  }
  if (knownKeys.length <= inlineLimit) {
    return {
      declarations: [],
      isUnknown: (keyVar) => knownKeys.map((key) => `${keyVar} !== ${JSON.stringify(key)}`).join(' && '),
    }
  }
  return {
    declarations: [`const ${setName} = new Set(${JSON.stringify(knownKeys)})`],
    isUnknown: (keyVar) => `!${setName}.has(${keyVar})`,
  }
}
