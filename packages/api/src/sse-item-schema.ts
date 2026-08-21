/**
 * Builds the OpenAPI 3.2 `itemSchema` for a `text/event-stream` response from
 * the schema of one event's payload.
 *
 * The item of an SSE stream is not the payload — it is the **event envelope**
 * the SSE grammar defines (`event`, `id`, `data`, `retry`), with the payload
 * inside `data`. Writing that envelope out by hand at every streaming route is
 * the kind of boilerplate that gets copied once and then drifts, so this
 * builds it: pass what the handler puts in `data`, get the item schema the
 * document should carry.
 *
 * ```typescript
 * const tokens = defineRoute({
 *   method: 'get',
 *   path: '/chat/{id}/stream',
 *   responses: {
 *     200: {
 *       contentType: 'text/event-stream',
 *       itemSchema: sseItemSchema({ type: 'string' }, { event: 'token' }),
 *     },
 *   },
 *   handler: ({ request }) => ({ status: 200, body: sseStream(tokens(), { signal: request.signal }) }),
 * })
 * ```
 *
 * `data` is typed as the schema given. That is deliberate even though SSE puts
 * a *string* on the wire: the document describes what a consumer gets after
 * parsing the field, which is what a generated type wants. Pass
 * `{ type: 'string' }` for a stream that really is raw text.
 *
 * When `event` names the event type, it is pinned as a `const` — a stream that
 * emits exactly one named event documents that name rather than leaving
 * consumers to guess it from prose.
 */
export const sseItemSchema = (
  dataSchema: unknown,
  options?: {
    /** Pins the `event` field to this name, for a single-event-type stream. */
    readonly event?: string
    /** Marks `id` present — set it for a resumable stream (`last-event-id`). */
    readonly id?: boolean
  },
): Record<string, unknown> => {
  // A self-contained payload schema resolves its internal `$ref`s against the
  // *document* root — `#` for itself, `#/$defs/…` for its definitions. Nesting
  // it under `properties.data` moves everything it points at, so each of those
  // pointers has to be re-aimed, or the document ends up carrying a dangling
  // `$ref` (or worse, a recursive `#` that now resolves to the SSE envelope
  // rather than to the payload) with no error anywhere.
  const { schema: nested, $defs: liftedDefs } = nestPayload(dataSchema)

  const properties: Record<string, unknown> = {
    event: options?.event === undefined ? { type: 'string' } : { type: 'string', const: options.event },
    data: nested,
    // The reconnection hint is part of the envelope the grammar defines, so a
    // schema claiming to describe an SSE item describes it too.
    retry: { type: 'integer' },
  }
  if (options?.id === true) properties['id'] = { type: 'string' }
  // Left open: the SSE grammar tells a client to ignore field names it does
  // not know, so `additionalProperties: false` would describe a stricter
  // stream than the protocol actually is.
  const item: Record<string, unknown> = { type: 'object', properties }
  if (liftedDefs !== undefined) item['$defs'] = liftedDefs
  // Never `required: ['data']`: a keep-alive comment frame carries no data,
  // and a `retry:`-only frame carries neither data nor event. Requiring them
  // would make the document reject frames the stream legitimately sends. A
  // pinned `event` is the one field every frame of such a stream does carry.
  if (options?.event !== undefined) item['required'] = ['event']
  return item
}

/** Where the payload ends up inside the envelope, as a JSON Pointer fragment. */
const DATA_POINTER = '#/properties/data'

/**
 * Re-aims a payload schema's local `$ref`s for life under `properties.data`,
 * lifting its `$defs` to the envelope root.
 *
 * `$defs` are lifted rather than re-pointed because `#/$defs/…` is by far the
 * common form and lifting keeps those refs correct verbatim. Everything else
 * local gains the `properties/data` prefix, and a bare `#` — the recursive
 * self-reference — becomes a pointer at the payload instead of at the
 * envelope, which is what it meant before the nesting.
 *
 * External refs are left alone: they resolve somewhere else entirely, and this
 * package does not follow them (that is `@amritk/resolve-refs`' job).
 */
const nestPayload = (schema: unknown): { schema: unknown; $defs: unknown } => {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return { schema, $defs: undefined }
  const { $defs, ...rest } = schema as Record<string, unknown>
  // Nothing local to move: hand the original back untouched, so a plain
  // payload keeps its identity and its object graph is not needlessly cloned.
  if ($defs === undefined && !hasLocalRef(schema)) return { schema, $defs: undefined }
  return { schema: rewriteLocalRefs(rest), $defs: $defs === undefined ? undefined : rewriteLocalRefs($defs) }
}

/**
 * Whether a schema carries a `$ref` that nesting would actually move — a
 * document-root JSON Pointer. An `$anchor` reference resolves by name and
 * stays valid, so a payload carrying only those needs no rewrite and no clone.
 */
const hasLocalRef = (node: unknown): boolean => {
  if (Array.isArray(node)) return node.some(hasLocalRef)
  if (typeof node !== 'object' || node === null) return false
  const record = node as Record<string, unknown>
  const ref = record['$ref']
  if (typeof ref === 'string' && (ref === '#' || ref === '#/' || ref.startsWith('#/'))) return true
  return Object.values(record).some(hasLocalRef)
}

const rewriteLocalRefs = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(rewriteLocalRefs)
  if (typeof node !== 'object' || node === null) return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out[key] = key === '$ref' && typeof value === 'string' ? rewriteRef(value) : rewriteLocalRefs(value)
  }
  return out
}

const rewriteRef = (ref: string): string => {
  if (ref === '#' || ref === '#/') return DATA_POINTER
  // Only JSON Pointers move. `#node` is an `$anchor` reference, which resolves
  // by name within the schema resource rather than by position — nesting does
  // not change where it lands, and prefixing it would splice the name onto the
  // pointer (`#/properties/datanode`) and dangle.
  if (!ref.startsWith('#/')) return ref
  // Lifted to the envelope root, so these still resolve exactly as written.
  if (ref.startsWith('#/$defs/') || ref === '#/$defs') return ref
  return `${DATA_POINTER}${ref.slice(1)}`
}
