import { findAnchor, resolveLocalRef } from '@/interpreter/resolve-local-ref'

/** A `$dynamicRef` binds only to a `$dynamicAnchor`, never a plain `$anchor`. */
const DYNAMIC_ANCHOR_KEYWORDS = ['$dynamicAnchor'] as const

/**
 * Resolves a JSON Schema 2020-12 `$dynamicRef` against the root document.
 *
 * The common (and, for us, only) shape is a plain-name fragment such as
 * `#meta`: it binds to the object in the document carrying the matching
 * `$dynamicAnchor` (`$dynamicAnchor: "meta"`). This is the pattern OpenAPI 3.1
 * uses so a media-type `schema` can late-bind to the root JSON Schema dialect.
 *
 * This is the resolver for a document that declares no `$id`. The real
 * dynamic-scope algorithm — walk the resources evaluation passed through and
 * bind to the *outermost* matching anchor — lives in `resolve-scoped-ref.ts`
 * and runs whenever the document has base URIs to scope anchors to. Without an
 * `$id` there is exactly one resource in play, so a name can only be declared
 * once and the document-global lookup here gives the same answer.
 *
 * A `$dynamicRef` with no matching `$dynamicAnchor`, or one written as a plain
 * JSON Pointer (`#/$defs/x`), falls back to {@link resolveLocalRef} so it still
 * behaves like a normal `$ref`. Returns `undefined` when nothing resolves, so
 * the caller can fail loudly rather than silently accept anything.
 */
export const resolveDynamicRef = (ref: string, root: unknown): unknown => {
  if (!ref.startsWith('#')) return undefined

  const fragment = ref.slice(1)
  // A plain-name fragment is a `$dynamicAnchor` lookup; a pointer (empty or
  // starting with "/") never names a dynamic anchor, so skip the search.
  if (fragment !== '' && !fragment.startsWith('/')) {
    const anchored = findAnchor(root, fragment, DYNAMIC_ANCHOR_KEYWORDS, new Set())
    if (anchored !== undefined) return anchored
  }

  // Either a pointer form or a dynamic anchor that does not exist — defer to the
  // static resolver so `$dynamicRef` degrades gracefully to `$ref` semantics.
  return resolveLocalRef(ref, root)
}

/**
 * Resolves a draft 2019-09 `$recursiveRef` against the root document. The only
 * spec-legal value is `"#"`: it late-binds to the subschema carrying
 * `$recursiveAnchor: true`, falling back to the document root when none exists.
 *
 * Like {@link resolveDynamicRef} this is the document-global approximation of
 * the dynamic-scope algorithm — correct for the single bundled document the
 * interpreter operates on, where at most one `$recursiveAnchor` is in play.
 */
export const resolveRecursiveRef = (root: unknown): unknown =>
  findAnchor(root, true, RECURSIVE_ANCHOR_KEYWORDS, new Set()) ?? root

const RECURSIVE_ANCHOR_KEYWORDS = ['$recursiveAnchor'] as const
