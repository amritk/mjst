/**
 * Indexes every `$ref` target in a document, plus each of its `/`-delimited
 * ancestors, so "is this reusable object referenced?" is a single set lookup.
 *
 * A component counts as used when a `$ref` targets it *or* points into it
 * (`#/components/schemas/Pet/properties/id` still uses `Pet`). Testing that
 * per component meant scanning every ref for a prefix match — O(components ×
 * refs), and the unreferenced-object rule copied the whole ref set into a fresh
 * array on each component to do it. Recording the ancestors once turns the whole
 * rule into O(refs + components).
 *
 * Shared by `unreferencedReusableObject` and the OpenAPI `oasUnusedComponent`,
 * which had a byte-identical copy of the walk between them.
 */
export const collectReferencedPointers = (document: unknown): Set<string> => {
  const pointers = new Set<string>()

  const add = (ref: string): void => {
    pointers.add(ref)
    // Every ancestor of the target is used too, so `#/components/schemas/Pet`
    // is a hit for a ref that reaches inside it.
    for (let slash = ref.lastIndexOf('/'); slash > 0; slash = ref.lastIndexOf('/', slash - 1)) {
      const prefix = ref.slice(0, slash)
      // An ancestor we have already recorded means the rest of the chain is in
      // too — every ref sharing this prefix walked it.
      if (pointers.has(prefix)) return
      pointers.add(prefix)
    }
  }

  // Iterative: document depth is attacker-controlled, and a recursive walk turns
  // a deeply nested file into a `RangeError` that takes the process down.
  const stack: unknown[] = [document]
  while (stack.length > 0) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item)
      continue
    }
    if (typeof node !== 'object' || node === null) continue
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') add(value)
      else stack.push(value)
    }
  }

  return pointers
}
