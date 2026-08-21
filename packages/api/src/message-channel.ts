import type { ValidationError } from '@amritk/runtime-validators'

import { createMessageQueue } from './create-message-queue'
import type { PreparedDirection } from './message-contracts'

/** Why a frame did not become a contract message. */
export type MessageFailureReason =
  /** Not text, or not JSON. */
  | 'malformed'
  /** A binary frame — nothing a JSON contract can describe. */
  | 'binary'
  /** No discriminator, or a name the contract does not declare. */
  | 'unknown-type'
  /** The right message, failing its own schema. */
  | 'invalid-payload'

/** A frame the contract refused, handed to {@link MessageChannelOptions.onInvalid}. */
export type MessageFailure = {
  readonly reason: MessageFailureReason
  /** The frame as it arrived, for logging. Never parsed past what failed. */
  readonly raw: string | Uint8Array
  /** The message name, when the frame got far enough to have one. */
  readonly name?: string
  /** Schema errors, for `invalid-payload`. */
  readonly errors?: readonly ValidationError[]
  /** One line, already truncated to fit a close reason. */
  readonly message: string
}

/** What to do with a refused frame. */
export type MessageFailureAction = 'close' | 'ignore'

/** Options shared by both ends of a channel. */
export type MessageChannelOptions = {
  /**
   * Called for every frame the contract refuses, deciding what happens next.
   * Returning `undefined` — including from a hook that just logs — keeps the
   * default: close for a frame that claims to be a contract message and is
   * not, ignore a binary frame.
   *
   * The hook exists because both alternatives are bad on their own. Closing
   * silently turns a schema typo into "the socket keeps dropping"; ignoring
   * silently means a peer sends malformed frames for a week and nobody knows.
   */
  readonly onInvalid?: (failure: MessageFailure) => MessageFailureAction | undefined
  /**
   * Validates outbound messages too, off by default — matching
   * `validateResponses`. Outbound messages are typed at compile time and are
   * this application's own output; paying to re-check them on every frame buys
   * little in production. Turn it on in development and tests.
   */
  readonly validateOutbound?: boolean
  /**
   * Buffers binary frames for `channel.binary`. Off by default.
   *
   * The queue underneath is deliberately unbounded, which is right for
   * messages a consumer is draining and wrong for a stream nobody asked for:
   * most channels never read `binary`, and a peer sending binary at one of
   * those would grow the heap until the connection closed. Gating it on a flag
   * rather than on first read is what makes it raceless — frames start
   * arriving the moment the connection opens, before any caller could have
   * subscribed.
   *
   * With this off, `channel.binary` is an iterator that has already ended, so
   * reading it finishes immediately rather than hanging.
   */
  readonly receiveBinary?: boolean
}

/**
 * The close code for a frame that broke the contract.
 *
 * RFC 6455's 1007 ("invalid frame payload data") is the semantically right
 * code and is what a peer's own validation layer looks for — but a JavaScript
 * caller is not allowed to send it. The WHATWG `WebSocket.close()` algorithm
 * accepts only 1000 and the private 3000–4999 range, and throws
 * `InvalidAccessError` for anything else; the 1xxx codes are reserved for the
 * implementation to send on its own behalf. Workers and Deno expose exactly
 * that interface for a server-role socket, so closing with 1007 threw from
 * inside the message listener — after the queues had already ended, which left
 * the consumer loop finished, the socket open, and every later frame silently
 * swallowed. (Verified: Node's WHATWG `WebSocket` rejects 1007 and accepts
 * 4007. Bun's `ServerWebSocket` is not the WHATWG interface and would take
 * either, but one portable code beats a per-runtime one.)
 *
 * 4007 keeps 1007's last three digits so the intent is still legible on the
 * wire, inside the range every implementation permits.
 */
export const INVALID_MESSAGE_CLOSE_CODE = 4007

/**
 * Closes a socket without letting a rejected close code escape.
 *
 * `close()` throws for a code the runtime will not send, and it is called from
 * inside a message listener where a throw is nobody's to catch — the socket
 * would stay open with its consumer already ended. A close that cannot carry
 * its reason is still better than no close, so the code is dropped and the
 * connection goes down either way.
 */
export const closeQuietly = (
  socket: { close: (code?: number, reason?: string) => unknown },
  code?: number,
  reason?: string,
): void => {
  try {
    socket.close(code, reason)
  } catch {
    try {
      socket.close()
    } catch {
      // Already closing or already gone; there is nothing further to try.
    }
  }
}

/**
 * RFC 6455 caps a close reason at 123 **bytes** of UTF-8. Overrunning it is
 * not a truncation — implementations throw, so an unusually long validation
 * message would turn a clean close into an exception on the way out.
 */
export const MAX_CLOSE_REASON_BYTES = 123

/**
 * Truncates a close reason to fit, on a UTF-8 boundary.
 *
 * Cutting by `slice` would count code units, and cutting a multi-byte
 * character in half produces a reason that is not valid UTF-8 — the same throw
 * this exists to avoid.
 */
export const truncateCloseReason = (reason: string): string => {
  const encoded = new TextEncoder().encode(reason)
  if (encoded.byteLength <= MAX_CLOSE_REASON_BYTES) return reason
  // `fatal: false` replaces a split trailing character rather than throwing;
  // trimming the replacement char leaves clean, valid text.
  const cut = new TextDecoder('utf-8').decode(encoded.slice(0, MAX_CLOSE_REASON_BYTES))
  return cut.replace(/�+$/, '')
}

/** Builds the one-line summary a failure carries, already close-reason sized. */
export const failureMessage = (reason: MessageFailureReason, detail?: string): string =>
  truncateCloseReason(detail === undefined ? reason : `${reason}: ${detail}`)

/**
 * Turns one raw frame into a contract message, or into a {@link MessageFailure}.
 *
 * Shared by both ends: the server validating what a client sent and the client
 * validating what the server pushed run exactly the same steps against the
 * opposite half of the same contract, which is what makes a contract violation
 * impossible to see from only one side.
 */
export const parseMessage = (
  raw: string | Uint8Array,
  validators: PreparedDirection,
  discriminator: string,
):
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly failure: MessageFailure } => {
  if (typeof raw !== 'string')
    return {
      ok: false,
      failure: { reason: 'binary', raw, message: failureMessage('binary', 'contract messages are JSON text') },
    }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, failure: { reason: 'malformed', raw, message: failureMessage('malformed', 'not JSON') } }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return {
      ok: false,
      failure: { reason: 'malformed', raw, message: failureMessage('malformed', 'not a JSON object') },
    }

  // Read as an own property: a frame naming `constructor` or `__proto__` would
  // otherwise pick up something off the prototype and look like a declared
  // message. The same reason the Node adapter reads headers this way.
  const tag = Object.hasOwn(parsed, discriminator) ? (parsed as Record<string, unknown>)[discriminator] : undefined
  if (typeof tag !== 'string')
    return {
      ok: false,
      failure: { reason: 'unknown-type', raw, message: failureMessage('unknown-type', `no '${discriminator}'`) },
    }

  const validator = validators.get(tag)
  if (validator === undefined)
    return {
      ok: false,
      failure: { reason: 'unknown-type', raw, name: tag, message: failureMessage('unknown-type', tag) },
    }

  // Validate the payload *without* the tag. The message schema describes the
  // payload, and the discriminator is this layer's framing, not the author's
  // field — so a schema that closes itself (`additionalProperties: false`,
  // directly or inside an `allOf`/`$ref`) stays satisfiable. Folding the tag
  // into a copy of the schema instead only worked for a plain object schema:
  // a closed subschema rejected the injected property and a valid frame closed
  // the socket with 1007.
  //
  // The shallow copy is the cost of that, one per inbound frame. Deleting and
  // restoring the key in place would avoid it, but mutating a value while a
  // validator reads it — and reordering its keys for anything that re-serializes
  // it afterwards — is not worth the allocation on a latency-bound path.
  const { [discriminator]: _tag, ...payload } = parsed as Record<string, unknown>
  const result = validator(payload)
  if (result !== true) {
    const first = result.errors[0]
    return {
      ok: false,
      failure: {
        reason: 'invalid-payload',
        raw,
        name: tag,
        errors: result.errors,
        message: failureMessage('invalid-payload', first === undefined ? tag : `${tag} ${first.path} ${first.message}`),
      },
    }
  }

  return { ok: true, value: parsed as Record<string, unknown> }
}

/**
 * The ingest half both ends share: a queue of accepted messages plus the
 * failure handling around it.
 *
 * `close` is injected rather than taken from a socket, because the two ends
 * close differently — a server closes the peer's connection, a client closes
 * its own — and the decision of *whether* to close is the shared part.
 */
export const createIngest = <T>(
  validators: PreparedDirection,
  discriminator: string,
  options: MessageChannelOptions | undefined,
  close: (code: number, reason: string) => void,
): {
  readonly accept: (raw: string | Uint8Array) => void
  readonly queue: ReturnType<typeof createMessageQueue<T>>
  readonly binary: ReturnType<typeof createMessageQueue<Uint8Array>>
} => {
  const queue = createMessageQueue<T>()
  // Binary frames get their own queue rather than being handed back through
  // the underlying connection. The channel drains that connection to feed
  // this one and the queue does not tee, so anything left there is
  // unreachable — a documented escape hatch that never yields is worse than
  // none. See `ClientMessageChannel.binary`.
  //
  // Buffering is opt-in (`receiveBinary`). See that option for why it is a flag
  // rather than something inferred from a first read.
  const binary = createMessageQueue<Uint8Array>()
  const receiveBinary = options?.receiveBinary === true
  // Ended up front when unwanted, so a caller that reads `binary` without the
  // option gets an immediate clean finish instead of parking forever.
  if (!receiveBinary) binary.end()
  const accept = (raw: string | Uint8Array): void => {
    const result = parseMessage(raw, validators, discriminator)
    if (result.ok) {
      queue.push(result.value as T)
      return
    }
    const failure = result.failure
    // A binary frame is not a broken contract — it is traffic this contract
    // does not describe, which a peer may legitimately be sending alongside
    // contract messages. Closing on it would make the two uses exclusive.
    const fallback: MessageFailureAction = failure.reason === 'binary' ? 'ignore' : 'close'
    const action = options?.onInvalid?.(failure) ?? fallback
    if (action === 'close') {
      close(INVALID_MESSAGE_CLOSE_CODE, failure.message)
      return
    }
    if (receiveBinary && failure.reason === 'binary' && typeof raw !== 'string') binary.push(raw)
  }
  return { accept, queue, binary }
}

/**
 * Validates one outbound message, throwing when it does not match its schema.
 *
 * Shared by both ends deliberately. The two `send` implementations are
 * otherwise identical, and when they were written separately they *both*
 * validated the message with its discriminator still attached — the same
 * mistake `parseMessage` had inbound, where a self-closing schema rejects a
 * property it never declared. One implementation cannot drift from itself.
 */
export const assertOutbound = (
  message: unknown,
  validators: PreparedDirection,
  discriminator: string,
  label: string,
  direction: string,
): void => {
  const record = message as Record<string, unknown>
  const name = record[discriminator]
  const validator = typeof name === 'string' ? validators.get(name) : undefined
  if (validator === undefined) throw new Error(`${label}: '${String(name)}' is not a ${direction} message`)
  // Stripped exactly as an inbound frame is: the schema describes the payload,
  // and the tag is this layer's framing.
  const { [discriminator]: _tag, ...payload } = record
  const result = validator(payload)
  if (result === true) return
  const first = result.errors[0]
  throw new Error(
    `${label}: outbound '${String(name)}' failed its schema: ` +
      (first === undefined ? 'unknown' : `${first.path} ${first.message}`),
  )
}
