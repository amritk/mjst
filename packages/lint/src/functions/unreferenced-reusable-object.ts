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

/** Flags entries in a reusable-object map that nothing `$ref`s. */
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
    const pointer = `${location}/${key}`
    if (!refs.has(pointer)) {
      results.push({
        message: 'This reusable object is never referenced',
        path: [...context.path, key],
      })
    }
  }
  return results
}
