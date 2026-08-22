import { asSchema, isObject } from '#helpers/guards'
import { couldBeObject, MAX_SCHEMA_DEPTH, RECURSION_STUB } from '#helpers/schema-shape'

/** A list of names, defensively — `required` is parsed JSON like everything else. */
const asStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

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
/**
 * Finds the node a plain-name fragment (`#node`) names, by looking for the
 * `$anchor` that declares it. 2020-12 lets a definition name itself this way,
 * and a reference to one used to resolve to nothing at all — the property kept
 * its name and lost its type, its prose and its whole subtree, which looks like
 * a documented property and is not one.
 */
const resolveAnchor = (node: unknown, anchor: string, depth = 0): unknown => {
  if (depth > MAX_SCHEMA_DEPTH) return undefined
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = resolveAnchor(item, anchor, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (!isObject(node)) return undefined
  if (node['$anchor'] === anchor || node['$dynamicAnchor'] === anchor) return node
  for (const [key, value] of Object.entries(node)) {
    // The same rules the inliner follows. A `default` or an `examples` entry is
    // documented *data*, and a sample that happens to hold an `$anchor` key is
    // not a definition — searching it let sample data win a reference. But the
    // keys of a `$defs` or a `properties` map are author-chosen names, so a
    // definition called `example` is a definition, and skipping it by name made
    // it unreachable.
    if (DATA_KEYWORDS.has(key)) continue
    if (SCHEMA_MAP_KEYWORDS.has(key) && isObject(value)) {
      for (const child of Object.values(value)) {
        const found = resolveAnchor(child, anchor, depth + 1)
        if (found !== undefined) return found
      }
      continue
    }
    const found = resolveAnchor(value, anchor, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

const resolvePointer = (root: Record<string, unknown>, ref: string): unknown => {
  // `#` is the empty pointer, which addresses the document itself — the
  // spelling every self-recursive schema uses (`items: { $ref: '#' }`). It
  // matched neither branch below, so a recursive structure lost its whole
  // shape and kept only its name.
  if (ref === '#' || ref === '#/') return root
  // `#name` names an `$anchor`; `#/…` is a JSON pointer. Anything else is a
  // reference out of the document, which this resolver does not fetch.
  if (/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(ref)) return resolveAnchor(root, ref.slice(1))
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
 * The `x-doc` members a truncation keeps from the definition it stands for.
 *
 * A whitelist, because the alternative was copying the whole keyword and every
 * member of it that means "where this is documented" then belonged to the wrong
 * node. `x-doc.page` on a definition tore its truncated child out of its parent
 * and republished it as a top-level heading on another file; and `$ref: '#'` —
 * the spelling every self-recursive schema uses — made the *root* the
 * definition, so a property called `parent` was headed with the page's title
 * and followed by the page's own example a second time.
 *
 * What is left is what a reader of a truncation still needs: what it is, and
 * what it says about itself. Where it goes, what it is called and how it sorts
 * are the ref site's to say. Its examples are not repeated either — the shape
 * is already documented in full further up the page, which is why this is a
 * truncation at all.
 */
const TRUNCATED_DOC_KEYS: readonly string[] = ['description', 'type', 'note', 'notes', 'footer', 'footers']

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
 * Follows the `$ref` hops a definition is reached through, so the node a stub
 * stands for is the one that actually describes something. A definition written
 * as a one-line alias (`Alias: { $ref: Real }`) carries nothing of its own, and
 * reading the alias gave the stub an empty picture of what it truncates.
 */
const resolveDefinition = (root: Record<string, unknown>, ref: string, depth = 0): unknown => {
  const target = resolvePointer(root, ref)
  if (!isObject(target) || depth > MAX_SCHEMA_DEPTH) return target
  const next = target['$ref']
  return typeof next === 'string' ? resolveDefinition(root, next, depth + 1) : target
}

/**
 * How many nodes one truncation may read while working out what the definition
 * it stands for requires.
 *
 * The walk follows `$ref`s through the *raw* schema, where a combinator
 * language — `Filter: And | Or`, each of `And` and `Or` inheriting `Filter`
 * through `allOf` — reaches the same definitions again by another path. Not
 * re-entering a definition already on the path is what makes that terminate at
 * all; before it did, a nine-line schema of exactly that shape never finished
 * rendering. This is the backstop for the schema that terminates and still
 * takes longer than anyone will wait.
 */
const MAX_REQUIRED_NODES = 10_000

/** One branch of a composition keyword, and the `$ref` it was reached through. */
type Branch = { readonly node: unknown; readonly ref: string | undefined }

/**
 * What a definition requires, as its own keyword and as its composition says.
 *
 * A stub records this because the collapse throws the rest away, and a union
 * containing one needs to know what the truncated alternative asks for — read
 * the stub as requiring nothing and it strips the markers off the alternatives
 * beside it. Requirements are as likely to arrive through an `allOf` (an
 * inherited base) or to be shared by every `anyOf` branch as they are to sit on
 * the definition itself, and reading only its own key found none of those.
 *
 * `seen` holds the definitions already on the path. A schema is free to compose
 * in a circle — that is what a recursive definition *is* — and a branch that
 * leads back to one being read contributes nothing new: to an `allOf` union
 * nothing at all, and to an intersection of alternatives the empty set, which
 * understates rather than invents.
 */
const requiredOf = (
  root: Record<string, unknown>,
  node: unknown,
  seen: ReadonlySet<string>,
  budget: Budget,
): readonly string[] => {
  if (!isObject(node)) return []
  if (budget.remaining-- <= 0) {
    throw new Error(
      `Reading what a recursive definition requires passed ${MAX_REQUIRED_NODES} nodes. Its $defs compose in ` +
        'too many ways to enumerate — flatten the composition, or the **Required** markers below it would be ' +
        'guesses.',
    )
  }
  const names = new Set(asStringArray(node['required']))
  const branchesOf = (keyword: unknown): readonly Branch[] =>
    (Array.isArray(keyword) ? keyword : []).map((branch): Branch => {
      const ref = isObject(branch) && typeof branch['$ref'] === 'string' ? branch['$ref'] : undefined
      return ref === undefined ? { node: branch, ref } : { node: resolveDefinition(root, ref), ref }
    })
  /** What a branch requires, or nothing when it leads back onto the path. */
  const requiredOfBranch = (branch: Branch): readonly string[] => {
    if (branch.ref === undefined) return requiredOf(root, branch.node, seen, budget)
    if (seen.has(branch.ref)) return []
    return requiredOf(root, branch.node, new Set(seen).add(branch.ref), budget)
  }

  // Every `allOf` branch applies, so its requirements all hold.
  for (const branch of branchesOf(node['allOf'])) for (const name of requiredOfBranch(branch)) names.add(name)
  // Alternatives hold only what they all ask for — and only the alternatives
  // that could be objects have a say, or the `string` half of `string | { … }`
  // strips the markers off the object half. The collector applies that rule to
  // the inlined document; applying it here too is what keeps one union from
  // being documented two ways on one page.
  for (const keyword of ['anyOf', 'oneOf']) {
    const branches = branchesOf(node[keyword]).filter((branch) => couldBeObject(asSchema(branch.node)))
    const [first, ...rest] = branches.map(requiredOfBranch)
    if (first === undefined) continue
    for (const name of first) if (rest.every((other) => other.includes(name))) names.add(name)
  }
  return [...names]
}

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
      // Recursive reference: stop here, keeping any description from the ref
      // site — and the requirements of the definition being truncated, which is
      // the only thing about it a reader of the stub still needs.
      const target = resolveDefinition(root, ref)
      const required = requiredOf(root, target, new Set([ref]), { remaining: MAX_REQUIRED_NODES })
      const resolvedSiblings = dereference(siblings, root, seen, budget, depth + 1) as Record<string, unknown>
      // The truncation keeps what a reader still needs of the definition: what
      // it is and what it says about itself. Only its shape is dropped, because
      // that is what is already on the page above.
      const carried: Record<string, unknown> = {}
      if (isObject(target)) {
        if (typeof target['description'] === 'string') carried['description'] = target['description']
        const doc = target[DOC_KEY]
        if (isObject(doc)) {
          const kept: Record<string, unknown> = {}
          for (const key of TRUNCATED_DOC_KEYS) if (Object.hasOwn(doc, key)) kept[key] = doc[key]
          if (Object.keys(kept).length > 0) carried[DOC_KEY] = kept
        }
      }
      // Merged the way any other `$ref` site's `x-doc` is, so the one rule
      // about prose holds on both routes: a ref site writing its own
      // `description` is describing *this* use and wins over the definition's.
      const stub: Record<string | symbol, unknown> = {
        type: 'object',
        ...carried,
        ...resolvedSiblings,
        ...mergedDoc(carried, resolvedSiblings),
      }
      // A ref site that declares its own shape is describing a real object, not
      // a truncation, so the marker does not travel onto it.
      if (resolvedSiblings['properties'] === undefined && resolvedSiblings['required'] === undefined) {
        stub[RECURSION_STUB] = required
      }
      return stub
    }
    const target = dereference(resolvePointer(root, ref), root, new Set(seen).add(ref), budget, depth + 1)
    const resolvedTarget = isObject(target) ? target : {}
    const resolvedSiblings = dereference(siblings, root, seen, budget, depth + 1) as Record<string, unknown>
    const merged: Record<string | symbol, unknown> = {
      ...resolvedTarget,
      ...resolvedSiblings,
      ...mergedApplicators(resolvedTarget, resolvedSiblings),
      ...mergedDoc(resolvedTarget, resolvedSiblings),
    }
    // The marker spreads with everything else, and a ref site that declares its
    // own fields is a real object however it was reached — an alias to a
    // recursive definition must not make it abstain.
    if (resolvedSiblings['properties'] !== undefined || resolvedSiblings['required'] !== undefined) {
      delete merged[RECURSION_STUB]
    }
    return merged
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
  // `#` starts out seen: the walk is already inside the document it names, so a
  // self-reference collapses to the stub the way `#/$defs/x` does on its second
  // visit. Without that seeding the whole root expanded one extra time, and a
  // property assigned to a page was documented on it twice.
  dereference(parsed, parsed, new Set(['#', '#/']), { remaining: MAX_INLINED_NODES }) as ConfigSchema
