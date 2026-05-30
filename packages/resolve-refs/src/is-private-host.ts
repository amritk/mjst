/**
 * Best-effort check for a hostname that resolves to a non-public address —
 * loopback, private (RFC 1918 / ULA), link-local (incl. the `169.254.169.254`
 * cloud-metadata endpoint), or otherwise host-local. This is a syntactic guard
 * on the URL only; it does not perform DNS, so a public name that resolves to a
 * private IP is not caught here. It exists to stop the obvious SSRF footguns
 * when resolving remote `$ref`s.
 */
export const isPrivateHost = (hostname: string): boolean => {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true

  // IPv4 (incl. IPv4-mapped IPv6 like ::ffff:127.0.0.1)
  const v4 = host.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    return false
  }

  // IPv6
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true
    if (host.startsWith('fe80:') || host.startsWith('fe80::')) return true // link-local
    if (host.startsWith('fc') || host.startsWith('fd')) return true // unique-local
    return false
  }
  return false
}
