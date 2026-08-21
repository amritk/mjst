/**
 * Extras merged into the handshake `ResponseInit`. Workers carries the client
 * end of a `WebSocketPair` here — a workerd-only field that no other runtime
 * reads and the Fetch types do not declare.
 */
export type SwitchingProtocolsInit = {
  readonly webSocket?: unknown
}

/**
 * Builds the `101 Switching Protocols` reply a completed WebSocket handshake
 * answers with.
 *
 * The fallback is the interesting part. The Fetch spec constrains a
 * constructed `Response` to statuses 200-599, and Node's undici enforces it:
 * `new Response(null, { status: 101 })` throws a `RangeError` there. Bun and
 * workerd both accept 101, because a handshake has no other status to report.
 * Since `toNodeHandler` cannot serve an upgrade at all, the only place Node
 * ever reaches this is a unit test, and a helper that throws on import into a
 * Node test runner would be untestable for no benefit. Falling back keeps the
 * accepted/refused branch under test everywhere while every runtime that can
 * actually complete a handshake still reports 101.
 *
 * Probed per call rather than cached at import: this runs once per connection,
 * not once per request, so the `try` costs nothing worth avoiding and the
 * module stays free of load-time side effects.
 */
export const switchingProtocols = (extra?: SwitchingProtocolsInit): Response => {
  const init = { status: 101, ...extra }
  try {
    return new Response(null, init)
  } catch {
    return new Response(null, { ...init, status: 200 })
  }
}
