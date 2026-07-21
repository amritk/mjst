/**
 * Signed cookies without a dependency — HMAC-SHA256 over the Web Crypto API,
 * so the same code runs on Workers, Bun, Deno, and Node ≥ 20. A signed value
 * is `<value>.<base64url-hmac>`; tampering with either half fails
 * verification. This is integrity, not secrecy — the value is still readable,
 * so do not put secrets in it; sign a session id and keep the session
 * server-side.
 */

const encoder = new TextEncoder()

// One imported CryptoKey per secret. Keyed by the secret string; a process
// rarely holds more than one or two, so an unbounded map is fine.
const keys = new Map<string, Promise<CryptoKey>>()

const keyFor = (secret: string): Promise<CryptoKey> => {
  let key = keys.get(secret)
  if (key === undefined) {
    key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ])
    keys.set(secret, key)
  }
  return key
}

const toBase64Url = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * Signs a cookie value, returning `<value>.<signature>`. Pass the result as
 * the cookie value; read it back with {@link unsignCookie}.
 */
export const signCookie = async (value: string, secret: string): Promise<string> => {
  const signature = await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(value))
  return `${value}.${toBase64Url(signature)}`
}

/**
 * Verifies a signed cookie and returns its original value, or `undefined` if
 * the value is unsigned, malformed, or the signature does not match. The
 * comparison runs through `crypto.subtle.verify`, which is constant-time.
 */
export const unsignCookie = async (signed: string, secret: string): Promise<string | undefined> => {
  const dot = signed.lastIndexOf('.')
  if (dot <= 0) return undefined
  const value = signed.slice(0, dot)
  const signature = signed.slice(dot + 1)
  let signatureBytes: Uint8Array<ArrayBuffer>
  try {
    signatureBytes = fromBase64Url(signature)
  } catch {
    return undefined
  }
  const valid = await crypto.subtle.verify('HMAC', await keyFor(secret), signatureBytes, encoder.encode(value))
  return valid ? value : undefined
}

/**
 * A `sign`/`unsign` pair bound to one secret — the ergonomic form when a
 * request handler signs and verifies many cookies. Rotate secrets by verifying
 * against several: `unsign` against the current secret first, then older ones.
 *
 * @example
 * ```typescript
 * const cookies = createSignedCookies(env.COOKIE_SECRET)
 * const setCookie = `sid=${await cookies.sign(sessionId)}; HttpOnly; Secure; SameSite=Lax`
 * const sessionId = await cookies.unsign(parsedCookie) // undefined if tampered
 * ```
 */
export const createSignedCookies = (
  secret: string,
): {
  readonly sign: (value: string) => Promise<string>
  readonly unsign: (signed: string) => Promise<string | undefined>
} => ({
  sign: (value) => signCookie(value, secret),
  unsign: (signed) => unsignCookie(signed, secret),
})
