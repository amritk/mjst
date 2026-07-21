/**
 * One part of a streamed `multipart/form-data` body. `data` yields the part's
 * bytes as they arrive — consume it (write to disk, pipe to object storage)
 * before advancing to the next part, so a large upload never sits whole in
 * memory. `name` is the form field name; `filename`/`contentType` are present
 * for file parts.
 */
export type MultipartPart = {
  readonly name: string
  readonly filename?: string | undefined
  readonly contentType?: string | undefined
  /** Every header line of the part, lowercased keys. */
  readonly headers: Readonly<Record<string, string>>
  /** The part body, streamed. Fully consume (or abandon) before the next part. */
  readonly data: AsyncIterableIterator<Uint8Array>
}

/**
 * Options for {@link streamMultipart}.
 */
export type StreamMultipartOptions = {
  /**
   * Largest per-part header block, in bytes. A part whose headers exceed it is
   * rejected (a malformed or hostile stream that never closes the header
   * section). Defaults to 16 KiB.
   */
  readonly maxHeaderBytes?: number
}

/** Pulls the boundary token out of a `multipart/form-data` content-type. */
export const multipartBoundary = (contentType: string): string => {
  const match = /boundary=(?:"([^"]+)"|([^";]+))/i.exec(contentType)
  const boundary = match?.[1] ?? match?.[2]
  if (boundary === undefined || boundary === '') {
    throw new Error('multipart: content-type has no boundary')
  }
  return boundary.trim()
}

const CRLF_CRLF = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a])

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const merged = new Uint8Array(a.length + b.length)
  merged.set(a)
  merged.set(b, a.length)
  return merged
}

/** First index of `needle` in `haystack` at or after `start`, or `-1`. */
const indexOf = (haystack: Uint8Array, needle: Uint8Array, start: number): number => {
  const limit = haystack.length - needle.length
  outer: for (let index = start; index <= limit; index++) {
    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[index + offset] !== needle[offset]) continue outer
    }
    return index
  }
  return -1
}

const parseHeaders = (block: string): Record<string, string> => {
  const headers: Record<string, string> = {}
  for (const line of block.split('\r\n')) {
    if (line === '') continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
  }
  return headers
}

const attribute = (disposition: string, name: string): string | undefined => {
  const match = new RegExp(`;\\s*${name}=(?:"([^"]*)"|([^";]+))`, 'i').exec(disposition)
  return match?.[1] ?? match?.[2]
}

/**
 * A streaming `multipart/form-data` parser — the large-file-upload path
 * FastAPI (`UploadFile`) and Fastify's streaming multipart give you, which
 * this framework's pipeline (buffering the whole body via `Response.formData`)
 * did not. Feed it the raw request body and its content-type; it yields each
 * part with the bytes streamed, so a multi-gigabyte upload flows through at
 * constant memory instead of landing in RAM all at once.
 *
 * Reach it from a handler through the raw request — `request.raw` is the Web
 * `Request` on the fetch adapter/compiled engine. Consume (or abandon) each
 * part's `data` before pulling the next; the parser drains an unconsumed part
 * for you when you advance.
 *
 * @example
 * ```typescript
 * handler: async ({ request }) => {
 *   const raw = request.raw as Request
 *   for await (const part of streamMultipart(raw.body!, raw.headers.get('content-type')!)) {
 *     if (part.filename !== undefined) {
 *       await uploadToStorage(part.filename, part.data) // stream straight through
 *     } else {
 *       // small text field — collect it
 *       let value = ''
 *       for await (const chunk of part.data) value += new TextDecoder().decode(chunk)
 *     }
 *   }
 *   return { status: 201 }
 * }
 * ```
 */
export async function* streamMultipart(
  body: ReadableStream<Uint8Array>,
  contentType: string,
  options?: StreamMultipartOptions,
): AsyncGenerator<MultipartPart> {
  const boundary = multipartBoundary(contentType)
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const dashBoundary = encoder.encode(`--${boundary}`)
  // A part body ends at CRLF + the dash-boundary; the leading CRLF belongs to
  // the boundary, not the content, so it is stripped by consuming the whole
  // delimiter.
  const delimiter = encoder.encode(`\r\n--${boundary}`)
  const maxHeaderBytes = options?.maxHeaderBytes ?? 16_384

  const reader = body.getReader()
  let buf: Uint8Array = new Uint8Array(0)
  let eof = false
  const pull = async (): Promise<boolean> => {
    if (eof) return false
    const { done, value } = await reader.read()
    if (done === true || value === undefined) {
      eof = true
      return false
    }
    buf = concat(buf, value)
    return true
  }

  // Skip the preamble and land just past the opening `--boundary`.
  for (;;) {
    const index = indexOf(buf, dashBoundary, 0)
    if (index !== -1) {
      buf = buf.subarray(index + dashBoundary.length)
      break
    }
    // Nothing in the current buffer can start a match except its last few
    // bytes — drop the rest so the preamble does not accumulate.
    buf = buf.subarray(Math.max(0, buf.length - (dashBoundary.length - 1)))
    if (!(await pull())) throw new Error('multipart: opening boundary not found')
  }

  for (;;) {
    // Right after a boundary: `--` closes the body, otherwise headers follow.
    while (buf.length < 2 && (await pull())) {
      // keep filling
    }
    if (buf.length >= 2 && buf[0] === 0x2d && buf[1] === 0x2d) return // "--" terminator

    // Read the header block (from the CRLF after the boundary up to a blank line).
    let separator = indexOf(buf, CRLF_CRLF, 0)
    while (separator === -1) {
      if (buf.length > maxHeaderBytes) throw new Error('multipart: part headers exceed limit')
      if (!(await pull())) throw new Error('multipart: unterminated part headers')
      separator = indexOf(buf, CRLF_CRLF, 0)
    }
    const headers = parseHeaders(decoder.decode(buf.subarray(0, separator)))
    buf = buf.subarray(separator + CRLF_CRLF.length)

    const disposition = headers['content-disposition'] ?? ''
    const name = attribute(disposition, 'name') ?? ''
    const filename = attribute(disposition, 'filename')
    const partContentType = headers['content-type']

    let partDone = false
    const data = (async function* (): AsyncIterableIterator<Uint8Array> {
      for (;;) {
        const index = indexOf(buf, delimiter, 0)
        if (index !== -1) {
          if (index > 0) yield buf.subarray(0, index)
          buf = buf.subarray(index + delimiter.length) // consume CRLF--boundary
          partDone = true
          return
        }
        // Emit everything that cannot overlap a future delimiter; retain the
        // tail in case the delimiter straddles this chunk and the next.
        const keep = delimiter.length - 1
        if (buf.length > keep) {
          const emit = buf.subarray(0, buf.length - keep)
          buf = buf.subarray(buf.length - keep)
          if (emit.length > 0) yield emit
        }
        if (!(await pull())) throw new Error('multipart: unterminated part body')
      }
    })()

    yield { name, filename, contentType: partContentType, headers, data }

    // If the consumer advanced without draining the part, finish it so the
    // parser is positioned at the next boundary.
    while (!partDone) {
      const result = await data.next()
      if (result.done === true) break
    }
  }
}
