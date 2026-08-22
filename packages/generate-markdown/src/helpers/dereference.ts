import { isObject } from '#helpers/guards'
import { DOC_KEY } from '#helpers/read-doc-meta'
import type { ConfigSchema } from '#types/schema'

/**
 * Decodes one JSON pointer segment: percent-decodes it (the pointer arrives as a
 * URI fragment, so `#/$defs/a%20b` addresses the definition named `a b`), then
 * unescapes `~1` → `/` and `~0` → `~` per RFC 6901. An invalid percent-escape is
 * left as written rather than throwing.
 */
const decodeSegment = (segment: string): string => {
  let decoded = segment
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    // Not a valid escape sequence, so the segment already reads as itself.
  }
  return decoded.replace(/~1/g, '/').replace(/~0/g, '~')
}

/**
 * Follows a JSON pointer (the fragment after `#/`, e.g. `$defs/server`) from the
 * document root. Returns `undefined` when the pointer can't be resolved so a
 * broken `$ref` degrades gracefully instead of throwing.
 *
 * Arrays are stepped into as well as objects. `#/$defs/timeout/anyOf/0` is an
 * ordinary pointer that real schemas write; refusing to index an array left the
 * referring property documented as a bare name with no type and no description.
 *
 * Only *own* properties are addressable. A bare `current[segment]` read let
 * `#/constructor` resolve to `Object`'s constructor, and — on a process where
 * anything had polluted `Object.prototype` — let an arbitrary `#/<name>` resolve
 * to the injected value instead of being reported as unresolvable.
 */
const resolvePointer = (root: Record<string, unknown>, ref: string): unknown => {
  if (!ref.startsWith('#/')) return undefined
  const segments = ref.slice(2).split('/').map(decodeSegment)
  let current: unknown = root
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined
    // RFC 6901 array indices are `0` or a digit string with no leading zero, so
    // `length` misses — and so do the spellings `Number` would have accepted
    // for a different element (`1.0`, `` (empty), ` 1`, `+1`).
    if (Array.isArray(current) && !/^(0|[1-9][0-9]*)$/.test(segment)) return undefined
    const key = Array.isArray(current) ? Number(segment) : segment
    if (!Object.hasOwn(current, key)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Assigns an own property. Plain assignment sets the prototype for a key named
 * `__proto__`, so a property with that name silently vanished from the README —
 * `JSON.parse` can produce it even though a JS object literal cannot.
 */
const defineOwn = (target: Record<string, unknown>, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

/**
 * Keywords whose value is *data* rather than a subschema. A `{"$ref": …}` sitting
 * in one of these is a documented config value that happens to be `$ref`-shaped,
 * not a reference to follow — inlining it would replace the value the reader is
 * supposed to copy with the definition it collided with.
 *
 * Kept in step by hand with `@amritk/helpers`' `DATA_KEYWORDS`: this package
 * takes no `@amritk/*` dependency by design, so the set is restated rather
 * than imported. `example` is OpenAPI 3.0's singular spelling and belongs with
 * `examples`.
 */
const DATA_KEYWORDS: ReadonlySet<string> = new Set(['default', 'const', 'enum', 'examples', 'example'])

/**
 * Keywords holding a *map of name → subschema*. Their keys are author-chosen
 * names, so a property legitimately called `default` must not be mistaken for the
 * `default` keyword — the entries are stepped into as schemas without consulting
 * {@link DATA_KEYWORDS}.
 */
const SCHEMA_MAP_KEYWORDS: ReadonlySet<string> = new Set([
  'properties',
  'patternProperties',
  'dependentSchemas',
  '$defs',
  'definitions',
  'dependencies',
])

/**
 * How many schema nodes the inlined document may contain. Inlining is a tree
 * expansion, so a definition reused twice at each of D nesting levels expands to
 * 2^D nodes: a 3 KB schema nested 22 deep never finished, and one nested 16 deep
 * quietly wrote a 29 MB README. Neither outcome is a document anyone can read,
 * so the walk stops and says why.
 *
 * Real config schemas are three orders of magnitude under this — the two in this
 * repo hold 41 and 7 nodes — so the budget only ever fires on an expansion that
 * has already gone wrong.
 */
export const MAX_INLINED_NODES = 100_000

/**
 * The remaining node allowance for one {@link dereference} walk. Mutable because
 * the budget is shared across every branch of the expansion — the cost that
 * matters is the total size of the inlined document, not the depth of any one
 * path through it.
 */
type Budget = { remaining: number }

/**
 * How deep the walk follows a schema. The node budget bounds how *much* is
 * inlined, which is the right guard for a `$ref` that expands exponentially —
 * but a plain, ref-free schema nested twelve thousand levels deep is only
 * twelve thousand nodes, and it overflowed the stack with a bare `RangeError`
 * naming nothing. Real config schemas nest tens of levels, not hundreds.
 */
export const MAX_SCHEMA_DEPTH = 512

/**
 * Merges the `x-doc` keyword of a `$ref` site with the one on the definition it
 * points at, rather than letting the ref site replace it wholesale.
 *
 * Every other keyword is replaced, which is what JSON Schema means by a sibling
 * winning. `x-doc` is different because it is a namespace rather than a value:
 * a definition carries the documentation that is true wherever it is used (its
 * examples, how its children lay out), and the ref site adds where *this* use is
 * documented (`page`, `section`). Replacing the whole object silently dropped a
 * definition's examples the moment a ref site assigned it to a page.
 */
const mergedDoc = (target: Record<string, unknown>, siblings: Record<string, unknown>): Record<string, unknown> => {
  const targetDoc = target[DOC_KEY]
  const siblingDoc = siblings[DOC_KEY]
  // A malformed `x-doc` at the ref site is ignored rather than allowed to wipe
  // the definition's, which is the opposite of what the merge is for.
  if (!isObject(targetDoc)) return {}
  const merged: Record<string, unknown> = isObject(siblingDoc) ? { ...targetDoc, ...siblingDoc } : { ...targetDoc }
  // The definition's prose describes the definition; a ref site that writes its
  // own `description` is describing *this* use, and must win — otherwise two
  // properties sharing one definition both print the definition's sentence and
  // neither prints its own. Only an `x-doc.description` at the ref site outranks
  // the plain one there.
  const siblingDocDescribes = isObject(siblingDoc) && 'description' in siblingDoc
  if (typeof siblings['description'] === 'string' && !siblingDocDescribes) delete merged['description']
  return { [DOC_KEY]: merged }
}

/**
 * Merges the applicator keywords that *add* rather than replace.
 *
 * A `$ref` alongside `properties` is two applicators on one node, and 2020-12
 * applies both: the referenced definition's fields and the ref site's fields
 * are all there. Letting the sibling replace them documented only the half the
 * author wrote at the ref site — the base type's fields disappeared, which is
 * the whole point of `{ $ref: Base, properties: { … } }`.
 */
const mergedApplicators = (
  target: Record<string, unknown>,
  siblings: Record<string, unknown>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = {}
  const targetProperties = target['properties']
  const siblingProperties = siblings['properties']
  if (isObject(targetProperties) && isObject(siblingProperties)) {
    const properties: Record<string, unknown> = {}
    // The ref site wins per name, the way `description` does.
    for (const [name, value] of Object.entries(targetProperties)) defineOwn(properties, name, value)
    for (const [name, value] of Object.entries(siblingProperties)) defineOwn(properties, name, value)
    merged['properties'] = properties
  }
  const targetRequired = target['required']
  const siblingRequired = siblings['required']
  if (Array.isArray(targetRequired) && Array.isArray(siblingRequired)) {
    merged['required'] = [...new Set([...targetRequired, ...siblingRequired])]
  }
  return merged
}

/**
 * Inlines every `$ref` in the schema by resolving it against the document root
 * (typically into `$defs`) and recursing into the result. Sibling keywords on a
 * `$ref` node — most commonly `description` — win over the referenced target, as
 * JSON Schema 2020-12 allows. A `seen` set of pointers along the current branch
 * breaks recursive definitions: the second time a ref is encountered it collapses
 * to a bare object stub so generation always terminates.
 *
 * Recursion is keyword-aware so it only follows refs in schema positions: the
 * values under {@link DATA_KEYWORDS} are copied through untouched, and the
 * name → schema maps in {@link SCHEMA_MAP_KEYWORDS} are stepped over so an
 * author's property named `default` is still treated as a schema.
 *
 * Terminating is not the same as finishing in a size anyone wants: a definition
 * reused at several levels of nesting is acyclic and still expands
 * exponentially, so the shared {@link Budget} caps the whole walk at
 * {@link MAX_INLINED_NODES} and throws when it runs out.
 */
export const dereference = (
  node: unknown,
  root: Record<string, unknown>,
  seen: ReadonlySet<string>,
  budget: Budget,
  depth = 0,
): unknown => {
  if (Array.isArray(node)) return node.map((item) => dereference(item, root, seen, budget, depth + 1))
  if (!isObject(node)) return node
  if (depth > MAX_SCHEMA_DEPTH) {
    throw new Error(
      `The schema nests more than ${MAX_SCHEMA_DEPTH} levels deep. Nothing that deep can be read as ` +
        'documentation — flatten it, or split the deep branch into definitions.',
    )
  }
  if (budget.remaining-- <= 0) {
    throw new Error(
      `Inlining the schema's $refs produced more than ${MAX_INLINED_NODES} nodes. A definition reused at several ` +
        'levels of nesting expands exponentially — flatten the $defs or reduce how deeply they nest.',
    )
  }

  const { $ref: ref, ...siblings } = node
  if (typeof ref === 'string') {
    if (seen.has(ref)) {
      // Recursive reference: stop here, keeping any description from the ref site.
      return { type: 'object', ...(dereference(siblings, root, seen, budget, depth + 1) as object) }
    }
    const target = dereference(resolvePointer(root, ref), root, new Set(seen).add(ref), budget, depth + 1)
    const resolvedTarget = isObject(target) ? target : {}
    const resolvedSiblings = dereference(siblings, root, seen, budget, depth + 1) as Record<string, unknown>
    return {
      ...resolvedTarget,
      ...resolvedSiblings,
      ...mergedApplicators(resolvedTarget, resolvedSiblings),
      ...mergedDoc(resolvedTarget, resolvedSiblings),
    }
  }

  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (DATA_KEYWORDS.has(key)) resolved[key] = value
    else if (SCHEMA_MAP_KEYWORDS.has(key) && isObject(value)) {
      const entries: Record<string, unknown> = {}
      for (const [name, child] of Object.entries(value))
        defineOwn(entries, name, dereference(child, root, seen, budget, depth + 1))
      resolved[key] = entries
    } else defineOwn(resolved, key, dereference(value, root, seen, budget, depth + 1))
  }
  return resolved
}

/**
 * Inlines every `$ref` in a parsed schema document against its own `$defs`.
 * The entry point every renderer uses, so they all share one node budget and
 * one set of rules about what counts as a schema position.
 */
export const dereferenceSchema = (parsed: Record<string, unknown>): ConfigSchema =>
  dereference(parsed, parsed, new Set(), { remaining: MAX_INLINED_NODES }) as ConfigSchema
