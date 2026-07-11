import type { IFunctionResult, RulesetFunction } from '../core'

/** Options for {@link unreferencedReusableObject}. */
export type IUnreferencedReusableObjectOptions = {
  /** JSON pointer to the map of reusable objects, e.g. "#/components/schemas". */
  reusableObjectsLocation: string
}

/** Collects every `$ref` string anywhere in `node` into `into`. */
const collectRefs = (node: unknown, into: Set<string>): void => {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, into)
    return
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') into.add(value)
      else collectRefs(value, into)
    }
  }
}

/** Escapes a key for use in a JSON pointer segment (`~` -> `~0`, `/` -> `~1`). */
const escapePointerSegment = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1')

/**
 * Flags entries in a reusable-object map that nothing `$ref`s.
 *
 * This must run against the *unresolved* document: once `$ref`s are inlined by a
 * resolver there are no references left to count, so every reusable object would
 * look orphaned.
 */
export const unreferencedReusableObject: RulesetFunction<
  Record<string, unknown>,
  IUnreferencedReusableObjectOptions
> = (input, options, context) => {
  if (typeof input !== 'object' || input === null) return []
  const location = options?.reusableObjectsLocation
  if (!location) return []

  const refs = new Set<string>()
  collectRefs(context.document.data, refs)

  const results: IFunctionResult[] = []
  for (const key of Object.keys(input)) {
    // A key such as "a/b" appears in a pointer as "a~1b", so escape it before
    // building the expected reference. Without this a legitimately referenced
    // object with a special character in its name looks unreferenced.
    const base = `${location}/${escapePointerSegment(key)}`
    // A reference can point straight at the object (`base`) or deeper into it
    // (e.g. `base/properties/x`); either counts as a use, so match the exact
    // pointer or any pointer nested beneath it.
    const referenced = refs.has(base) || [...refs].some((ref) => ref.startsWith(`${base}/`))
    if (!referenced) {
      results.push({
        message: 'This reusable object is never referenced',
        path: [...context.path, key],
      })
    }
  }
  return results
}
