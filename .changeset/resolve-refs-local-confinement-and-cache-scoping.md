---
'@amritk/resolve-refs': minor
---

Close the local-file, cache-scoping, and fan-out gaps in the resolver's guards

This package's selling point is a default-deny SSRF guard. These are the places
the guard did not reach.

**Local `$ref`s are now confined to the root document's directory.** `$ref`
resolution against the filesystem had no containment check and no way to turn it
off: `{"$ref": "../../../etc/passwd"}` (or an absolute path) read whatever the
process could read, and any caller supplying the YAML `parse` callback the docs
recommend got arbitrary text, not just JSON. A local ref must now resolve under
`dirname(rootLocation)`; both the lexical and the symlink-resolved path have to
land inside it, so a symlink planted in the tree cannot be used to escape.

This is a **behavior change**: a legitimate cross-directory ref
(`../common/schemas.json` — a very normal split-spec layout) now fails until you
widen it with the new `allowedRoots`, which the refusal message names. The
default was chosen to match the stance the remote path already took — deny, then
opt in — since the escaping ref and the traversal attack are the same shape and
only the caller can tell them apart. The root document you name is exempt; it is
what you asked for. `localRefs: false` refuses cross-file reads entirely.

**The session cache no longer leaks documents across credentials.** It was keyed
by URL alone, so a call carrying one tenant's `Authorization` header handed that
tenant's private document straight to a later call carrying no credentials at
all — and in-flight coalescing additionally made the second caller inherit the
first one's `fetch`, `timeoutMs`, and `maxBytes`. Both keys now include a digest
of the effective headers plus the `fetch`/`parse` identities and the transfer
limits. The cache is also bounded now (10-minute TTL, 256 entries, LRU
eviction) instead of growing for the life of the process, and
`clearRemoteCache(url)` can drop a single document.

**A resolve is bounded as a whole.** A root document with 500 `$ref`s to distinct
URLs drove 501 fetches with nothing but the per-hop timeout bounding it — an
egress amplifier and a host scanner, from the resolver's network position. New
`maxDocuments` (500) and `totalTimeoutMs` (60s, applied across the whole resolve
and not just per hop) cap it.

**Deeply nested documents no longer throw.** `'{"a":'.repeat(20000)` raised
`RangeError: Maximum call stack size exceeded` out of the walkers, breaking the
package's stated contract that errors are collected and never thrown. Every
recursive walk is depth-capped (`maxDepth`, default 512); past the limit the
subtree is left unresolved and one `ResolveError` is recorded.

**The SSRF guard is no longer name-blind.** `metadata.google.internal`,
`metadata.goog`, `metadata`, `instance-data`, and anything under the reserved
`.internal` TLD are refused by name — the IP check missed all of them, because
callers reach the metadata service by name. The new `assertPublicHost` also
resolves each remote hostname and refuses it when *any* address it points at is
non-public, which closes the `127.0.0.1.nip.io` class of bypass; it fails closed,
and `verifyDns: false` (or an `allowedHosts` entry) opts out where names resolve
at an egress proxy. DNS rebinding is narrowed, not closed: pinning the connection
to the verified address is not something Node's `fetch` exposes, and the README
says so rather than overclaiming.

**Missing IP ranges added:** `fec0::/10` (deprecated site-local),
`198.18.0.0/15` (benchmarking), and `192.0.0.0/24` (IETF protocol assignments).

**`allowedHosts` is no longer a footgun.** Matching was case-sensitive and
port-exact, so `['example.com']` refused `https://example.com:8443/a.json` and
`['EXAMPLE.com']` refused everything — failing closed, but pushing users toward
`allowPrivateHosts`, which is a real hole. Entries now match case-insensitively;
an entry without a port matches any port, and one with a port must match it
(a URL that omits the port counts as its protocol default).
