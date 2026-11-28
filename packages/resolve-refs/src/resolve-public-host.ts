import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { isPrivateHost } from './is-private-host'

/**
 * Resolves a hostname to the addresses it points at. Only the `address` is used
 * — the shape matches `dns.lookup(host, { all: true })` so the real resolver
 * drops straight in. Exposed as a parameter so the guard can be exercised
 * against known records without a live resolver, and so a caller that resolves
 * names some other way (a custom DoH client) can supply it.
 */
export type HostLookup = (hostname: string) => Promise<{ address: string }[]>

/** An address that passed the guard, with the family a socket needs to dial it. */
export type PublicAddress = { address: string; family: 4 | 6 }

// `all` so a name with several records cannot hide a private address behind a
// public one; `verbatim` keeps the resolver's own ordering (we check every entry
// anyway, so the order only decides which one the error names).
const defaultLookup: HostLookup = (hostname) => lookup(hostname, { all: true, verbatim: true })

/**
 * Resolves `hostname` once and returns its addresses, rejecting if **any** of
 * them is non-public. Returning the addresses (rather than a yes/no) is the
 * point: a caller that dials exactly these — see `pinned-fetch` — closes the
 * DNS-rebinding window, because there is no second lookup for the record to
 * change under.
 *
 * {@link isPrivateHost} runs first so an IP literal or a denied name never
 * costs a resolver round-trip, and so the refusal reads the same either way.
 *
 * **Fails closed.** A lookup that errors, returns nothing, or returns something
 * that is not an IP address is rejected: we cannot show the host is public.
 */
export const resolvePublicHost = async (
  hostname: string,
  lookupHost: HostLookup = defaultLookup,
): Promise<PublicAddress[]> => {
  const host = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
    .toLowerCase()
  if (host === '') throw new Error('host is empty')
  if (isPrivateHost(host)) {
    throw new Error(`host "${hostname}" is a private or loopback address (set allowPrivateHosts to permit)`)
  }

  let answers: { address: string }[]
  try {
    answers = await lookupHost(host)
  } catch (err) {
    throw new Error(
      `cannot verify that host "${hostname}" is public: DNS lookup failed (${String(err)}) (allow-list the host or set verifyDns: false to skip this check)`,
    )
  }
  if (answers.length === 0) {
    throw new Error(
      `cannot verify that host "${hostname}" is public: DNS returned no addresses (allow-list the host or set verifyDns: false to skip this check)`,
    )
  }

  return answers.map(({ address }) => {
    const family = isIP(address)
    // A custom lookup could hand back a name instead of an address; dialing it
    // would mean resolving again, which is exactly the gap this exists to close.
    if (family !== 4 && family !== 6) {
      throw new Error(`cannot verify that host "${hostname}" is public: DNS returned "${address}", not an IP address`)
    }
    if (isPrivateHost(address)) {
      throw new Error(
        `host "${hostname}" resolves to the non-public address ${address} (set allowPrivateHosts to permit)`,
      )
    }
    return { address, family }
  })
}
