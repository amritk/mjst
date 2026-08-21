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
  const properties: Record<string, unknown> = {
    event: options?.event === undefined ? { type: 'string' } : { type: 'string', const: options.event },
    data: dataSchema,
    // The reconnection hint is part of the envelope the grammar defines, so a
    // schema claiming to describe an SSE item describes it too.
    retry: { type: 'integer' },
  }
  if (options?.id === true) properties['id'] = { type: 'string' }
  // Left open: the SSE grammar tells a client to ignore field names it does
  // not know, so `additionalProperties: false` would describe a stricter
  // stream than the protocol actually is.
  const item: Record<string, unknown> = { type: 'object', properties }
  // Never `required: ['data']`: a keep-alive comment frame carries no data,
  // and a `retry:`-only frame carries neither data nor event. Requiring them
  // would make the document reject frames the stream legitimately sends. A
  // pinned `event` is the one field every frame of such a stream does carry.
  if (options?.event !== undefined) item['required'] = ['event']
  return item
}
