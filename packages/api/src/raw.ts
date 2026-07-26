import type { RawReply } from './types'

/**
 * Wraps a web `Response` as the {@link RawReply} escape hatch, for a handler or
 * guard that needs full control of the wire output:
 *
 * ```typescript
 * handler: async ({ request }) => raw(await fetch(upstream, { redirect: 'manual' })),
 * ```
 *
 * The adapters send the wrapped response verbatim — it skips response
 * validation and serialization entirely, so the status it carries need not
 * appear in `responses`. Prefer a typed `{ status, body }` reply everywhere
 * else, so the contract stays the source of truth.
 *
 * The wrapper is what keeps ordinary replies inferring: a bare `Response` in
 * the handler's return union carries `status: number`, which disqualifies
 * `status` as the union's discriminant and makes TypeScript reject any reply
 * whose own status is a union of declared literals. See {@link RawReply}.
 */
export const raw = (response: Response): RawReply => ({ raw: response })
