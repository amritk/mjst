/**
 * Best-effort check for a hostname that resolves to a non-public address —
 * loopback, private (RFC 1918 / ULA), link-local (incl. the `169.254.169.254`
 * cloud-metadata endpoint), or otherwise host-local — plus a small denylist of
 * names that always mean "infrastructure endpoint" (`metadata.google.internal`,
 * anything under `.internal`, …).
 *
 * This is a **syntactic** guard on the URL only: it does not perform DNS, so a
 * public name that resolves to a private IP (`127.0.0.1.nip.io` and friends, or
 * a rebinding record) is not caught here. Use `assertPublicHost` for that — it
 * resolves the name and runs every returned address back through this check.
 * This one stays synchronous and pure because it is the cheap first pass, and
 * because callers outside the fetch path (the CLI, `@amritk/lint`) use it as a
 * plain predicate.
 */

/** True for an IPv4 address (as a 32-bit number) in a non-public range. */
const isPrivateIpv4 = (value: number): boolean => {
  const a = (value >>> 24) & 0xff
  const b = (value >>> 16) & 0xff
  const c = (value >>> 8) & 0xff
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 benchmarking
  // 192.0.0.0/24 — IETF protocol assignments (DS-Lite `192.0.0.1`, NAT64
  // discovery, …). Only the /24, so the ordinary public space in 192.0.0.0/16
  // (TEST-NET-1 aside) stays reachable.
  if (a === 192 && b === 0 && c === 0) return true
  // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved (which is where the
  // `255.255.255.255` broadcast address lives). Neither is a public unicast
  // destination, so neither is somewhere a schema can be published — and this
  // predicate's answer is "is this address public", which for these is no.
  if (a >= 224) return true
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
 * Resolves an IPv4 host written in any inet_aton form (dotted/decimal/octal/hex,
 * 1–4 parts) to its 32-bit value, or `null` if it is not an IPv4 literal. The
 * WHATWG URL parser normalizes these to dotted-decimal before they reach us, but
 * a direct caller (this is an exported guard) can pass the raw form.
 */
const ipv4Value = (host: string): number | null => {
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
  return value >>> 0
}

/**
 * Expands a hex IPv6 literal (no dotted-IPv4 tail — that is handled separately)
 * into its eight 16-bit groups, resolving `::` zero-compression. Returns null if
 * the string is not a well-formed hex IPv6 address.
 */
const expandHexIpv6 = (host: string): number[] | null => {
  const halves = host.split('::')
  if (halves.length > 2) return null
  const toGroups = (part: string): number[] | null => {
    if (part === '') return []
    const groups: number[] = []
    for (const g of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null
      groups.push(Number.parseInt(g, 16))
    }
    return groups
  }
  const head = toGroups(halves[0] as string)
  if (head === null) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const tail = toGroups(halves[1] as string)
  if (tail === null) return null
  const fill = 8 - head.length - tail.length
  if (fill < 0) return null
  return [...head, ...new Array<number>(fill).fill(0), ...tail]
}

/**
 * When an expanded IPv6 address embeds an IPv4 address in its low 32 bits,
 * returns that IPv4 as a 32-bit number; otherwise null. Covers every embedding
 * the WHATWG URL parser can hand us as bare hex — the `ffff:`-only regex this
 * replaced let `::7f00:1` (`::127.0.0.1`) and `::a9fe:a9fe` (`::169.254.169.254`)
 * through, since those normalize away the `ffff:` marker:
 *   - `::/96` compatible (`::X:Y`, also covers `::`/`::1`),
 *   - IPv4-mapped (`::ffff:X:Y`),
 *   - IPv4-translated (`::ffff:0:X:Y`),
 *   - NAT64 (`64:ff9b::/96`).
 */
const ipv4EmbeddedInIpv6 = (g: number[]): number | null => {
  const [a, b, c, d, e, f, hi, lo] = g as [number, number, number, number, number, number, number, number]
  const embedded = (hi * 0x10000 + lo) >>> 0
  const zeros4 = a === 0 && b === 0 && c === 0 && d === 0
  if (zeros4 && e === 0 && f === 0) return embedded // ::/96 compatible
  if (zeros4 && e === 0 && f === 0xffff) return embedded // ::ffff:X:Y mapped
  if (zeros4 && e === 0xffff && f === 0) return embedded // ::ffff:0:X:Y translated
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return embedded // 64:ff9b::/96 NAT64
  return null
}

/**
 * Names that always identify infrastructure rather than a public document, no
 * matter what they resolve to. `metadata.google.internal` / `metadata.goog` are
 * the GCP instance-metadata endpoints (the `169.254.169.254` IP check misses
 * them because callers reach them by name), `instance-data` is the EC2 alias,
 * and a bare `metadata` is the search-domain-completed form of both. Cheap and
 * unambiguous — nobody publishes a schema at these names.
 */
const DENIED_HOST_NAMES = new Set(['metadata', 'metadata.google.internal', 'metadata.goog', 'instance-data'])

export const isPrivateHost = (hostname: string): boolean => {
  // Strip IPv6 brackets and any trailing dot(s): `localhost.` is the FQDN-root
  // form of `localhost` and resolves to the same loopback address, so it must
  // not slip past the by-name checks below.
  const host = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
    .toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (DENIED_HOST_NAMES.has(host)) return true
  // `.internal` is an ICANN-reserved TLD for private use (and what AWS/GCP hand
  // out inside a VPC), so anything under it is by definition not public.
  if (host.endsWith('.internal') || host.endsWith('.metadata.goog')) return true

  if (host.includes(':')) {
    // --- IPv6 (and IPv4-mapped IPv6) ---
    if (host === '::1' || host === '::') return true
    // fe80::/10 link-local spans fe80–febf (third nibble 8–b); fec0::/10 is the
    // deprecated site-local range (fec0–feff), still routed on plenty of
    // networks and still not public.
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true
    if (/^fe[c-f][0-9a-f]:/.test(host)) return true
    if (host.startsWith('fc') || host.startsWith('fd')) return true // fc00::/7 unique-local

    // IPv4-mapped/compatible, dotted (`::ffff:127.0.0.1`, `::127.0.0.1`) — the URL
    // parser rewrites these to hex, but a direct caller may pass the dotted form.
    const dotted = /:((?:\d{1,3}\.){3}\d{1,3})$/.exec(host)
    if (dotted?.[1]) {
      const value = ipv4Value(dotted[1])
      if (value !== null) return isPrivateIpv4(value)
    }
    // Every hex IPv4-in-IPv6 embedding `new URL()` can produce (mapped,
    // compatible, translated, NAT64) — via a full expansion rather than a
    // single-form regex, which missed `::7f00:1` / `::a9fe:a9fe`. This also
    // catches the fully-expanded loopback `0:0:0:0:0:0:0:1`.
    const groups = expandHexIpv6(host)
    if (groups) {
      const embedded = ipv4EmbeddedInIpv6(groups)
      if (embedded !== null) return isPrivateIpv4(embedded)
    }
    return false
  }

  // --- IPv4 (any inet_aton encoding) ---
  const value = ipv4Value(host)
  if (value !== null) return isPrivateIpv4(value)
  return false
}
