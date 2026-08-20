import { assignKey } from './assign-key'
import { resolveUri, SYNTHETIC_BASE } from './build-resource-registry'
import { refToFilename } from './ref-to-filename'

/**
 * Folds documents the caller has already loaded into the document being
 * generated, so a `$ref` that names another document resolves like any other.
 *
 * The generators are a single-document pipeline by construction: `$id` is applied
 * once by {@link normalizeRefScopes}, every ref becomes a pointer from the
 * document root, and the ref-graph walk, the filename and type-name derivation
 * and the emitted import graph all work in that one currency. A ref to a
 * *separate* resource had nowhere to land in that model — not because the URI
 * could not be resolved, but because the bytes were somewhere else — so
 * generation stopped.
 *
 * Grafting closes that gap without teaching any of the machinery a second
 * addressing mode. Each registered document is embedded in the root's `$defs` as
 * what it already is — a schema resource carrying its own base URI — and from
 * that point on it *is* part of the document: the registry walk registers its
 * `$id`, its anchors and its own embedded resources, `normalizeRefScopes`
 * rewrites refs into it to plain pointers, and the walker gives it files and type
 * names by the ordinary rules. Cross-document `$ref`, `$anchor` and
 * `$dynamicAnchor` all start working at once, and nothing downstream had to
 * change.
 *
 * This is the build-time counterpart of `@amritk/runtime-validators`'
 * `ValidateOptions.schemas`, and it keeps the same promise: no I/O. The documents
 * are handed over, never fetched — loading them is the caller's job (or
 * `@amritk/resolve-refs`'). A URI nobody registered is still refused, loudly, at
 * generation time.
 *
 * Registered documents that nothing references cost nothing in the output: the
 * ref-graph walk only emits files for definitions it can actually reach, so a
 * caller can register a whole directory and ship only what the schema uses.
 */

/**
 * A grafted document: the root to carry on with, and the `$defs` names the graft
 * introduced.
 *
 * The names matter downstream because a registered document is *not* quite an
 * authored one: a caller is meant to be able to over-register, so the ones
 * nothing references have to be identifiable in order to be dropped again (see
 * {@link pruneExternalSchemas}).
 */
export type GraftedSchema = {
  readonly document: Record<string, unknown>
  readonly names: ReadonlySet<string>
}

/**
 * How a registered document's `$id` relates to the URI it was registered under,
 * which is the only thing that decides how it has to be embedded.
 */
type GraftPlan =
  /** No `$id` of its own: it takes the retrieval URI as its base. */
  | { readonly kind: 'adopt-uri' }
  /** Its `$id` already resolves to the retrieval URI, so it embeds verbatim. */
  | { readonly kind: 'self-identified' }
  /** Its `$id` says something else, so both URIs have to keep working. */
  | { readonly kind: 'aliased'; readonly id: string }

/**
 * The absolute form of a URI a document was registered under. Keys are meant to
 * be absolute already, so this only normalizes the spelling (`URL`
 * canonicalization, fragment dropped). A key `URL` cannot parse is kept verbatim:
 * string equality still matches it, so an unusual scheme resolves rather than
 * silently disappearing. Mirrors `@amritk/runtime-validators`' `normalizeUri`, so
 * the two packages agree on what a registry key means.
 */
const normalizeUri = (uri: string): string => {
  const resolved = resolveUri(uri, SYNTHETIC_BASE)
  if (resolved === undefined) return uri
  const hash = resolved.indexOf('#')
  return hash === -1 ? resolved : resolved.slice(0, hash)
}

/** How `document` has to be embedded to answer to `uri`. */
const planFor = (document: object, uri: string): GraftPlan => {
  const id = (document as Record<string, unknown>)['$id']
  if (typeof id !== 'string' || id === '') return { kind: 'adopt-uri' }
  // A relative `$id` resolves against the URI the document was retrieved from,
  // which is exactly what a base URI is for.
  const resolved = resolveUri(id, uri)
  if (resolved === undefined) return { kind: 'adopt-uri' }
  const hash = resolved.indexOf('#')
  const bare = hash === -1 ? resolved : resolved.slice(0, hash)
  // A draft-07-style `$id: "#name"` resolves to a bare fragment and establishes
  // no base at all, so the retrieval URI is still the one in scope.
  if (bare === '') return { kind: 'adopt-uri' }
  return bare === uri ? { kind: 'self-identified' } : { kind: 'aliased', id: bare }
}

/**
 * The object form of a registered document, so it can carry an `$id`.
 *
 * A boolean schema is a legal document, and `true`/`false` say exactly what `{}`
 * and `{ not: {} }` say — but a boolean has nowhere to put the base URI the
 * retrieval URI establishes, so it is spelled out here.
 */
const asResource = (document: unknown): Record<string, unknown> | undefined => {
  if (document === true) return {}
  if (document === false) return { not: {} }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) return undefined
  return document as Record<string, unknown>
}

/**
 * Embeds each registered document into `root`'s `$defs`, returning a new root.
 *
 * The document keeps its own `$id` when it has one, and is given the retrieval
 * URI as its `$id` when it does not — which is what makes a relative `$ref`
 * *inside* a registered document resolve against the URI it was fetched from
 * rather than against the root's base. When a document's `$id` disagrees with the
 * URI it was registered under, both have to keep naming it, so a tiny alias
 * resource (`{ $id: <retrieval URI>, $ref: <its own $id> }`) is embedded
 * alongside it and refs to the retrieval URI land there.
 *
 * Every registered document is embedded, whether or not the schema mentions it —
 * which of them are needed is not knowable until the base URIs have been applied
 * and the refs are pointers. {@link pruneExternalSchemas} drops the rest once
 * that is done.
 *
 * `root` is returned by identity when there is nothing to graft, so the
 * overwhelmingly common no-registry call allocates nothing.
 *
 * @param root - The document being generated.
 * @param schemas - Already-loaded documents, keyed by the absolute URI a `$ref`
 *   names them by.
 * @returns The root document in which every registered URI is resolvable, and
 *   the `$defs` names the graft introduced.
 * @throws When two registered URIs, or a registered URI and an existing `$defs`
 *   entry, want the same definition name — the name is what every emitted import
 *   is keyed on, so picking a winner would silently mistype one of them.
 *
 * @example
 * ```ts
 * graftExternalSchemas(
 *   { $ref: 'https://example.com/user.json' },
 *   { 'https://example.com/user.json': { type: 'object' } },
 * ).document
 * // → { $ref: 'https://example.com/user.json', $defs: { user: { $id: '…', type: 'object' } } }
 * ```
 */
export const graftExternalSchemas = (
  root: Record<string, unknown>,
  schemas: Readonly<Record<string, unknown>>,
): GraftedSchema => {
  const uris = Object.keys(schemas)
  if (uris.length === 0) return { document: root, names: EMPTY_NAMES }

  const existing = root['$defs']
  const inherited =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : undefined

  const defs: Record<string, unknown> = { ...inherited }
  /** Which URI claimed each definition name, so a clash can name both sides. */
  const claimed = new Map<string, string>()
  const names = new Set<string>()

  /** Reserves `name` for `uri`, refusing a name that is already spoken for. */
  const claim = (name: string, uri: string): string => {
    const owner = claimed.get(name)
    if (owner !== undefined) {
      throw new Error(
        `The registered schemas "${owner}" and "${uri}" both reduce to the definition name "${name}", so only one ` +
          'of them could be embedded and every reference to the other would resolve to the wrong schema. Register ' +
          'one of them under a URI whose last path segment differs.',
      )
    }
    if (inherited !== undefined && Object.hasOwn(inherited, name)) {
      throw new Error(
        `The registered schema "${uri}" reduces to the definition name "${name}", which the root document already ` +
          'declares in $defs. Rename the root definition, or register the schema under a URI whose last path ' +
          'segment differs.',
      )
    }
    claimed.set(name, uri)
    names.add(name)
    return name
  }

  for (const key of uris) {
    const resource = asResource(schemas[key])
    // A registered value that is not a schema at all cannot be embedded as one.
    // Skipping matches the runtime registry, which ignores the same entries, and
    // leaves the ref that names it to be refused by the walker with a message
    // about the ref rather than about the registry.
    if (resource === undefined) continue

    const uri = normalizeUri(key)
    const plan = planFor(resource, uri)
    const name = claim(refToFilename(uri), uri)

    // `assignKey`, not `defs[name] = …`: a URI whose last segment is `__proto__`
    // reduces to that definition name, and a plain assignment there runs the
    // prototype setter — the registered document vanishes from `$defs` while
    // `names` still reports it, and `defs` starts inheriting the document's own
    // keys, so a later `defs.type` reads a value the map never had.
    assignKey(defs, name, plan.kind === 'adopt-uri' ? { $id: uri, ...resource } : resource)

    if (plan.kind === 'aliased') {
      // The document answers to its own `$id`; this makes the retrieval URI name
      // it too, which is the whole point of registering it under a URI. An alias
      // *resource* rather than a rewritten `$id` because both spellings stay
      // live: another registered document may well reference the `$id` one.
      assignKey(defs, claim(`${name}-retrieved`, uri), { $id: uri, $ref: plan.id })
    }
  }

  return names.size === 0 ? { document: root, names: EMPTY_NAMES } : { document: { ...root, $defs: defs }, names }
}

/** Shared empty result, so the no-registry path allocates nothing at all. */
const EMPTY_NAMES: ReadonlySet<string> = new Set<string>()
