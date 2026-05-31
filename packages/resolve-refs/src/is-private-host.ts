/**
 * Best-effort check for a hostname that resolves to a non-public address —
 * loopback, private (RFC 1918 / ULA), link-local (incl. the `169.254.169.254`
 * cloud-metadata endpoint), or otherwise host-local. This is a syntactic guard
 * on the URL only; it does not perform DNS, so a public name that resolves to a
 * private IP is not caught here. It exists to stop the obvious SSRF footguns
 * when resolving remote `$ref`s.
 */

/** True for an IPv4 address (given its first two octets) in a non-public range. */
const isPrivateIpv4 = (a: number, b: number): boolean => {
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  return false
}

/** Parses a single IPv4 part in decimal, octal (`0…`), or hex (`0x…`) form. */
const parseIpv4Part = (s: string): number | null => {
  if (/^0x[0-9a-f]+$/i.test(s)) return Number.parseInt(s, 16)
  if (/^0[0-7]*$/.test(s)) return Number.parseInt(s, 8)
  if (/^[1-9][0-9]*$/.test(s)) return Number.parseInt(s, 10)
  return null
}

/**
 * Resolves the first two octets of an IPv4 host written in any inet_aton form
 * (dotted/decimal/octal/hex, 1–4 parts), or `null` if it is not an IPv4 literal.
 * The WHATWG URL parser normalizes these to dotted-decimal before they reach us,
 * but a direct caller (this is an exported guard) can pass the raw form.
 */
const ipv4Octets = (host: string): [number, number] | null => {
  if (!/^[0-9a-fx.]+$/i.test(host)) return null
  const parts = host.split('.')
  if (parts.length === 0 || parts.length > 4) return null
  const nums: number[] = []
  for (const part of parts) {
    const n = parseIpv4Part(part)
    if (n === null) return null
    nums.push(n)
  }
  // inet_aton packing: every part but the last is one byte; the last fills the
  // remaining low bytes (so `127.1` is 127.0.0.1 and `2130706433` is too).
  let value = 0
  for (let i = 0; i < nums.length - 1; i++) {
    const byte = nums[i] as number
    if (byte > 0xff) return null
    value = value * 256 + byte
  }
  const remaining = 4 - (nums.length - 1)
  const last = nums[nums.length - 1] as number
  if (last > 256 ** remaining - 1) return null
  value = value * 256 ** remaining + last
  if (value > 0xffffffff) return null
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff]
}

export const isPrivateHost = (hostname: string): boolean => {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true

  if (host.includes(':')) {
    // --- IPv6 (and IPv4-mapped IPv6) ---
    if (host === '::1' || host === '::') return true
    // fe80::/10 link-local spans fe80–febf (third nibble 8–b).
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true
    if (host.startsWith('fc') || host.startsWith('fd')) return true // fc00::/7 unique-local

    // IPv4-mapped/compatible, dotted (`::ffff:127.0.0.1`) — the URL parser
    // rewrites this to hex, but a direct caller may pass the dotted form.
    const dotted = /:((?:\d{1,3}\.){3}\d{1,3})$/.exec(host)
    if (dotted?.[1]) {
      const oct = ipv4Octets(dotted[1])
      if (oct) return isPrivateIpv4(oct[0], oct[1])
    }
    // IPv4-mapped, hex (`::ffff:7f00:1`) — what `new URL()` produces.
    const hex = /:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
    if (hex?.[1] && hex[2]) {
      const hi = Number.parseInt(hex[1], 16)
      return isPrivateIpv4((hi >> 8) & 0xff, hi & 0xff)
    }
    return false
  }

  // --- IPv4 (any inet_aton encoding) ---
  const oct = ipv4Octets(host)
  if (oct) return isPrivateIpv4(oct[0], oct[1])
  return false
}
