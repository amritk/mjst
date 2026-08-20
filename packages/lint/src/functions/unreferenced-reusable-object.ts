import type { IFunctionResult, RulesetFunction } from '../core/types'
import { collectReferencedPointers } from './ref-index'

/** Options for {@link unreferencedReusableObject}. */
export type IUnreferencedReusableObjectOptions = {
  /** JSON pointer to the map of reusable objects, e.g. "#/components/schemas". */
  reusableObjectsLocation: string
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

  // The index holds every `$ref` target *and* its ancestors, so a reference that
  // points deeper into an object (`…/Pet/properties/x`) still counts as a use of
  // the object itself.
  const referenced = collectReferencedPointers(context.document.data)

  const results: IFunctionResult[] = []
  for (const key of Object.keys(input)) {
    // A key such as "a/b" appears in a pointer as "a~1b", so escape it before
    // building the expected reference. Without this a legitimately referenced
    // object with a special character in its name looks unreferenced.
    if (!referenced.has(`${location}/${escapePointerSegment(key)}`)) {
      results.push({
        message: 'This reusable object is never referenced',
        path: [...context.path, key],
      })
    }
  }
  return results
}
