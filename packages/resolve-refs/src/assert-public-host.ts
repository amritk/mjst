import { lookup } from 'node:dns/promises'

import { isPrivateHost } from './is-private-host'

/**
 * Resolves a hostname to the addresses it points at. Only the `address` is used
 * — the shape matches `dns.lookup(host, { all: true })` so the real resolver
 * drops straight in. Exposed as a parameter so the guard can be exercised
 * against known records without a live resolver, and so a caller that resolves
 * names some other way (a custom DoH client) can supply it.
 */
export type HostLookup = (hostname: string) => Promise<{ address: string }[]>

// `all` so a name with several records cannot hide a private address behind a
// public one; `verbatim` keeps the resolver's own ordering (we check every entry
// anyway, so the order only decides which one the error names).
const defaultLookup: HostLookup = (hostname) => lookup(hostname, { all: true, verbatim: true })

/**
 * The name-resolving half of the SSRF guard: resolves `hostname` and rejects if
 * **any** address it resolves to is non-public. {@link isPrivateHost} only reads
 * the URL, so `127.0.0.1.nip.io` — a public-looking name whose A record is
 * `127.0.0.1` — sails past it. This closes that hole for the fetch path.
 *
 * It is deliberately a separate async function rather than a change to
 * `isPrivateHost`: that predicate is synchronous, pure, and exported (the CLI
 * and `@amritk/lint` pass it URL hostnames), and making it async would break
 * every caller for no gain outside the fetch path.
 *
 * **Fails closed.** A lookup that errors, or returns nothing, is rejected: we
 * cannot show the host is public, and a name we cannot resolve was almost
 * certainly not going to be fetched anyway. Environments where the *proxy* does
 * the resolving (so names do not resolve locally) should allow-list the host or
 * pass `verifyDns: false`.
 *
 * **Residual gap — DNS rebinding is narrowed, not closed.** Between this check
 * and the connection, the record can change to a private address (the classic
 * TOCTOU rebind). Truly closing it means pinning the socket to the address we
 * just verified, and Node's `fetch` offers no seam for that. What this does buy:
 * a name that *statically* points at a private address — the overwhelmingly
 * common case, every `nip.io`-style trick included — is refused, and an attacker
 * is pushed to a short-TTL rebinding record instead of a plain A record.
 *
 * Rejects with an `Error` explaining the refusal; resolves when the host looks
 * public.
 */
export const assertPublicHost = async (hostname: string, lookupHost: HostLookup = defaultLookup): Promise<void> => {
  const host = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
    .toLowerCase()
  if (host === '') throw new Error('host is empty')
  // The syntactic pass runs first so an IP literal or a denied name never costs
  // a resolver round-trip, and so the refusal reads the same either way.
  if (isPrivateHost(host)) {
    throw new Error(`host "${hostname}" is a private or loopback address (set allowPrivateHosts to permit)`)
  }

  let addresses: { address: string }[]
  try {
    addresses = await lookupHost(host)
  } catch (err) {
    throw new Error(
      `cannot verify that host "${hostname}" is public: DNS lookup failed (${String(err)}) (allow-list the host or set verifyDns: false to skip this check)`,
    )
  }
  if (addresses.length === 0) {
    throw new Error(
      `cannot verify that host "${hostname}" is public: DNS returned no addresses (allow-list the host or set verifyDns: false to skip this check)`,
    )
  }
  for (const { address } of addresses) {
    if (isPrivateHost(address)) {
      throw new Error(
        `host "${hostname}" resolves to the non-public address ${address} (set allowPrivateHosts to permit)`,
      )
    }
  }
}
