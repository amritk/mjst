import { type HostLookup, resolvePublicHost } from './resolve-public-host'

export type { HostLookup } from './resolve-public-host'

/**
 * The name-resolving half of the SSRF guard: resolves `hostname` and rejects if
 * **any** address it resolves to is non-public. {@link isPrivateHost} only reads
 * the URL, so `127.0.0.1.nip.io` — a public-looking name whose A record is
 * `127.0.0.1` — sails past it.
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
 * **A check on its own does not stop DNS rebinding.** Anything that resolves the
 * name again before connecting can be handed a different, private answer.
 * `resolveRefsFromFile` does not rely on this function for its own fetches: it
 * dials the very addresses it verified. Use this as a pre-check only where the
 * connection is made by code you cannot pin, and treat it as advisory there.
 *
 * Rejects with an `Error` explaining the refusal; resolves when the host looks
 * public.
 */
export const assertPublicHost = async (hostname: string, lookupHost?: HostLookup): Promise<void> => {
  await resolvePublicHost(hostname, lookupHost)
}
