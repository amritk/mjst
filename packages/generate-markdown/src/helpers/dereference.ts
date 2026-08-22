import { asSchema, isObject } from '#helpers/guards'
import { couldBeObject, MAX_SCHEMA_DEPTH, RECURSION_STUB, type ShapeContext } from '#helpers/schema-shape'

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
 * The `x-doc` members a truncation does *not* take from the definition it
 * stands for: the ones that describe where a property appears and how it is
 * announced, rather than what it is.
 *
 * Everything else is documentation of the thing itself and travels with it, as
 * it does through any other `$ref`. These five belong to the occurrence, and a
 * truncation is an occurrence with nothing underneath it:
 *
 * - `page` and `section` tore a truncated child out of its parent and
 *   republished it on another file as a top-level heading with nothing under it.
 * - `heading: false` means "the heading above already names this, and the
 *   children stand on their own". A truncation has no children, so the property
 *   vanished outright and its sentence read as a second paragraph of its
 *   sibling's prose.
 * - `title` renamed every truncation of one definition to the same string:
 *   three `### Node` headings on one page, three colliding anchors, and the
 *   names the reader has to type nowhere in the document.
 * - `order` sorts an occurrence among its siblings, which is the ref site's
 *   business for the same reason.
 *
 * A ref site is still free to write any of them: what it says about *this* use
 * wins, the way it does for every other member.
 */
const PLACEMENT_DOC_KEYS: ReadonlySet<string> = new Set(['page', 'section', 'title', 'heading', 'order'])

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
 * What one {@link dereference} walk carries: the remaining node allowance, and
 * what each truncated `$ref` requires.
 *
 * The allowance is mutable because it is shared across every branch of the
 * expansion — the cost that matters is the total size of the inlined document,
 * not the depth of any one path through it.
 *
 * The requirements are cached because working them out is a pure function of
 * the document and the pointer, and a definition reached by a hundred
 * truncations was being read a hundred times. A layered `$defs` graph took 75
 * seconds of that for a 3 KB schema — and then failed on the node allowance
 * anyway, so the whole 75 seconds bought an error message.
 */
type Budget = { remaining: number; readonly required: Map<string, readonly string[]> }

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

/** The node allowance and the resolved-shape answers one reading shares. */
type Reading = { remaining: number; readonly shape: ShapeContext }

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
  budget: Reading,
  depth = 0,
): readonly string[] => {
  if (!isObject(node)) return []
  // A chain of one-line alias definitions is not a cycle, so `seen` never cuts
  // it — and a code generator emits those by the thousand. The node allowance
  // counts nodes, not frames, so without this the walk recursed until the stack
  // gave out and said only `RangeError`. Which runtime it gave out on decided
  // whether anyone saw it at all.
  if (depth > MAX_SCHEMA_DEPTH) {
    throw new Error(
      `Following the schema's composition passed ${MAX_SCHEMA_DEPTH} levels. Flatten the \`allOf\` chain — ` +
        'nothing composed that deep can be read as documentation.',
    )
  }
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
      if (!isObject(branch) || typeof branch['$ref'] !== 'string') return { node: branch, ref: undefined }
      const { $ref: ref, ...rest } = branch
      // The ref site's own keywords apply alongside the definition's, which is
      // what the inliner does with them. Replacing the branch with the
      // definition dropped a `required` written at the ref site, so the same
      // union was documented one way inlined and another truncated.
      const target = resolveDefinition(root, ref)
      return { node: isObject(target) ? { ...target, ...rest } : rest, ref }
    })
  /** What a branch requires, or nothing when it leads back onto the path. */
  const requiredOfBranch = (branch: Branch): readonly string[] => {
    if (branch.ref === undefined) return requiredOf(root, branch.node, seen, budget, depth + 1)
    if (seen.has(branch.ref)) return []
    return requiredOf(root, branch.node, new Set(seen).add(branch.ref), budget, depth + 1)
  }

  // Every `allOf` branch applies, so its requirements all hold.
  for (const branch of branchesOf(node['allOf'])) for (const name of requiredOfBranch(branch)) names.add(name)
  // Alternatives hold only what they all ask for — and only the alternatives
  // that could be objects have a say, or the `string` half of `string | { … }`
  // strips the markers off the object half. The collector applies that rule to
  // the inlined document; applying it here too is what keeps one union from
  // being documented two ways on one page.
  for (const keyword of ['anyOf', 'oneOf']) {
    const branches = branchesOf(node[keyword]).filter((branch) => couldBeObject(asSchema(branch.node), budget.shape))
    const [first, ...rest] = branches.map(requiredOfBranch)
    if (first === undefined) continue
    for (const name of first) if (rest.every((other) => other.includes(name))) names.add(name)
  }
  return [...names]
}

/**
 * What a truncated definition *is*, with nothing about what it holds.
 *
 * The stub used to say `type: 'object'` whatever it stood for, so a definition
 * spelled `string | { not: Filter }` was labelled `object` at every recursive
 * position — telling the reader a string is not valid there — and contributed a
 * phantom `object` to the label of any union it sat in.
 *
 * Only the keywords that decide the **Type:** label are kept, and the branches
 * are reduced the same way, so nothing here can put a property back on a node
 * whose whole point is that its shape was dropped. A reference that leads back
 * onto the path contributes nothing, which is what makes the label finite.
 */
const typeSkeleton = (
  root: Record<string, unknown>,
  node: unknown,
  seen: ReadonlySet<string>,
  depth = 0,
): Record<string, unknown> | undefined => {
  if (!isObject(node) || depth > MAX_SCHEMA_DEPTH) return undefined
  const ref = node['$ref']
  if (typeof ref === 'string') {
    if (seen.has(ref)) return undefined
    return typeSkeleton(root, resolveDefinition(root, ref), new Set(seen).add(ref), depth + 1)
  }
  const shape: Record<string, unknown> = {}
  for (const key of ['type', 'enum', 'const']) if (node[key] !== undefined) defineOwn(shape, key, node[key])
  if (Object.keys(shape).length > 0) return shape
  for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
    const branches = node[keyword]
    if (!Array.isArray(branches)) continue
    const reduced = branches
      .map((branch) => typeSkeleton(root, branch, seen, depth + 1))
      .filter((branch): branch is Record<string, unknown> => branch !== undefined)
    if (reduced.length > 0) return { [keyword]: reduced }
  }
  return undefined
}

/**
 * The documentation a truncation carries from the definition it stands for,
 * merged along the `$ref` chain the way the inliner merges it at every hop.
 *
 * Reading the end of the chain instead gave a truncation of `Alias` the prose
 * and the title of `Base`, while a reference to the same `Alias` one level up
 * carried `Alias`'s — the same pointer documented two ways on one page.
 */
const carriedDoc = (
  root: Record<string, unknown>,
  ref: string,
  depth = 0,
): { description?: string; doc?: Record<string, unknown> } => {
  const node = resolvePointer(root, ref)
  // The root is not a definition: its `x-doc` is the *page's* configuration —
  // its title, its examples, its notes — and copied onto a property the page
  // introduced itself a second time under the property's name.
  if (!isObject(node) || node === root || depth > MAX_SCHEMA_DEPTH) return {}
  const next = node['$ref']
  const base = typeof next === 'string' ? carriedDoc(root, next, depth + 1) : {}
  const own = isObject(node[DOC_KEY]) ? (node[DOC_KEY] as Record<string, unknown>) : undefined
  const doc: Record<string, unknown> = { ...base.doc }
  if (own !== undefined) for (const [key, value] of Object.entries(own)) defineOwn(doc, key, value)
  const description = typeof node['description'] === 'string' ? node['description'] : base.description
  // The same rule `mergedDoc` applies: a plain `description` at this hop is
  // describing this node, and outranks the `x-doc.description` it inherited.
  if (typeof node['description'] === 'string' && (own === undefined || !('description' in own))) {
    delete doc['description']
  }
  for (const key of PLACEMENT_DOC_KEYS) delete doc[key]
  return {
    ...(description !== undefined && { description }),
    ...(Object.keys(doc).length > 0 && { doc }),
  }
}

/** {@link requiredOf} for one pointer, worked out once per walk. */
const requiredOfRef = (root: Record<string, unknown>, ref: string, budget: Budget): readonly string[] => {
  const cached = budget.required.get(ref)
  if (cached !== undefined) return cached
  const reading: Reading = {
    remaining: MAX_REQUIRED_NODES,
    shape: { resolve: (target) => resolveDefinition(root, target) },
  }
  const names = requiredOf(root, resolveDefinition(root, ref), new Set([ref]), reading)
  budget.required.set(ref, names)
  return names
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
    // The document itself, however the reference spells it. `#` and `#/` are
    // seeded as seen; a plain-name fragment naming the root's own `$anchor` is
    // the third spelling, and it expanded the whole document a second time
    // under a property's name before anything noticed.
    if (seen.has(ref) || resolvePointer(root, ref) === root) {
      // Recursive reference: stop here, keeping any description from the ref
      // site — and the requirements of the definition being truncated, which is
      // the only thing about it a reader of the stub still needs.
      const required = requiredOfRef(root, ref, budget)
      const resolvedSiblings = dereference(siblings, root, seen, budget, depth + 1) as Record<string, unknown>
      // The truncation keeps the definition's documentation, the way any other
      // `$ref` site does — its prose, its type label, its layout, its examples,
      // whether it is hidden. Only its shape is dropped, because that is what is
      // already on the page above.
      const { description, doc } = carriedDoc(root, ref)
      const carried: Record<string, unknown> = {
        ...(description !== undefined && { description }),
        ...(doc !== undefined && { [DOC_KEY]: doc }),
      }
      // Merged the way any other `$ref` site's `x-doc` is, so the one rule
      // about prose holds on both routes: a ref site writing its own
      // `description` is describing *this* use and wins over the definition's.
      const stub: Record<string | symbol, unknown> = {
        ...(typeSkeleton(root, resolvePointer(root, ref), new Set([ref])) ?? { type: 'object' }),
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
  dereference(parsed, parsed, new Set(['#', '#/']), {
    remaining: MAX_INLINED_NODES,
    required: new Map(),
  }) as ConfigSchema
