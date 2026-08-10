# @amritk/resolve-refs

Resolve and inline JSON Schema / OpenAPI `$ref`s — internal pointers, cross-file
refs, and remote (http/https) documents — into a single dereferenced document.

- **One-pass, cached.** Every unique ref is resolved once; the result is always
  finite. At a reference **cycle** the recursive branch is *kept*, not lost: the
  cycle point stays a `$ref` that resolves within the output document (a
  cross-file cycle target is hoisted into the root's `$defs`), so recursive
  schemas survive dereferencing intact.
- **Anchors + dynamic refs, `$id`-scoped.** Beyond JSON-pointer `$ref`s,
  plain-name `$anchor` references (`#node`), `$dynamicRef`/`$dynamicAnchor`
  (2020-12), and `$recursiveRef`/`$recursiveAnchor` (2019-09) are dereferenced
  too. `$id` base-URI scoping is modelled for the bundled-document case: a ref
  whose URI matches an embedded resource's `$id` resolves to it without
  fetching, and anchors bind within the resource that declares them (falling
  back to a document-global search). See *`$id` scoping* below for the exact
  subset.
- **Cross-file + remote.** Relative refs resolve against the document they appear
  in (a ref inside a remote doc stays remote, one inside a local file stays
  local). Fetched remote documents are cached for the session, keyed by URL *and*
  by the credentials they were fetched with.
- **Default-deny SSRF guard.** Remote refs to loopback, private, link-local, and
  cloud-metadata hosts — by IP (`169.254.169.254`) *and* by name
  (`metadata.google.internal`, anything under `.internal`) — are refused unless
  you opt in. Hostnames are additionally resolved and refused when any address
  they point at is non-public, so `127.0.0.1.nip.io` does not slip through.
- **Default-deny local reads.** A local `$ref` may only resolve **under the root
  document's directory**. `{"$ref": "../../../secrets.env"}` is refused; widen it
  with `allowedRoots` when your spec legitimately spans folders.
- **OpenAPI Reference Objects.** A `$ref` whose only siblings are `summary` /
  `description` inlines the target with those annotations overriding — matching
  OpenAPI 3.1 Reference Object semantics, where an `allOf` wrapper would be
  invalid. Any other sibling keyword keeps the spec-correct `allOf` combination.

## Usage

```ts
import { resolveRefs, resolveRefsFromFile } from '@amritk/resolve-refs'

// In-memory, internal (#/...) refs only. External refs (another file or an
// http(s) URL) are left in place and reported on `errors`, since this resolver
// can't load other documents — use resolveRefsFromFile for those:
const { resolved, errors } = resolveRefs(myDocument)

// From disk or a URL, including cross-file and remote refs:
const result = await resolveRefsFromFile('./schema.json')
const remote = await resolveRefsFromFile('https://api.example.com/schema.json', {
  allowedHosts: ['api.example.com'],
})
```

### Options (`resolveRefsFromFile`)

| Option | Default | Description |
|:---|:---|:---|
| `remote` | `true` | Whether http(s) refs may be fetched at all. |
| `localRefs` | `true` | Whether `$ref`s to other files on disk may be read. `false` still reads the root document you named — it refuses everything a ref reaches out to. |
| `allowedRoots` | `[dirname(root)]` | Directories a local `$ref` must resolve inside. The default confines a ref to the folder holding the root document. |
| `allowedHosts` | `[]` | If non-empty, only these hosts may be fetched. Matched case-insensitively; an entry without a port matches any port, one with a port must match it (a URL that omits the port counts as its protocol default). An explicit entry bypasses the private-host and DNS guards. |
| `allowPrivateHosts` | `false` | Allow loopback/private/link-local targets. Left off, these are refused as an SSRF guard. |
| `verifyDns` | `true` | Resolve each remote host and refuse it when any address it resolves to is non-public. Pass `false` where names resolve at an egress proxy rather than locally. |
| `headers` | — | Extra headers for remote requests (record, or `(url) => headers` for per-host credentials). Never sent across a cross-origin redirect. |
| `fetch` | global `fetch` | Custom fetch implementation. The SSRF guard still evaluates every hop before it is called. |
| `timeoutMs` | `30_000` | Abort an unresponsive remote fetch after this many milliseconds. |
| `totalTimeoutMs` | `60_000` | Wall-clock budget for the whole resolve, across every document. |
| `maxDocuments` | `500` | Documents (root included) a single resolve may load. |
| `maxRedirects` | `5` | Redirect hops to follow per remote document (each hop re-runs the SSRF guard). |
| `maxBytes` | `16` MiB | Refuse to buffer a remote document larger than this. |
| `maxDepth` | `512` | How deep to walk before leaving a subtree unresolved and recording an error. |
| `cache` | `true` | Pass `false` to bypass the process-wide session cache for this call — everything is re-fetched, nothing is stored. |
| `parse` | `JSON.parse` | Custom content parser (e.g. YAML-aware). |
| `trackOrigins` | `false` | Record a per-node origin map on the result. |

Errors (a missing file, a refused host, a refused path, a bad URL, a document too
deeply nested) are collected on `result.errors` rather than thrown; the
corresponding ref resolves to `{}` so the rest of the document still resolves.

`clearRemoteCache()` drops every cached remote document — useful in tests or
long-lived sessions where remote schemas may change. Pass a URL
(`clearRemoteCache(url)`) to drop just that one. The cache expires entries after
10 minutes and evicts the least recently used past 256 documents, so a long-lived
process does not accumulate every schema it has ever seen.

### Security posture

The remote path has always been default-deny; the local path now matches it.

- **Local reads are confined** to `dirname(rootLocation)` unless you pass
  `allowedRoots`. This is deliberately strict: a ref like `../common/schemas.json`
  — an ordinary split-spec layout — is refused until you opt in, because the same
  shape is what reads `/etc/passwd` out of a document you did not write. Both the
  lexical and the symlink-resolved path must land inside a root, so a symlink
  planted in the tree cannot be used to escape it. The root document itself is
  exempt: it is the file you explicitly named.
- **The session cache is credential-scoped.** Its key covers the request headers,
  the `fetch`/`parse` callbacks, and the transfer limits, so a document fetched
  with one tenant's token is invisible to a call carrying different (or no)
  credentials — and no caller inherits another's `fetch`. In-flight coalescing
  uses the same key.
- **The SSRF guard runs in two passes.** `isPrivateHost` is synchronous and reads
  only the URL (every IPv4 encoding, IPv4-in-IPv6 embeddings, ULA/link-local/
  site-local IPv6, plus a name denylist for cloud-metadata endpoints).
  `assertPublicHost` then resolves the name and refuses it when any address is
  non-public. Both run on every redirect hop.
- **Known residual gap: DNS rebinding.** A record that changes between the check
  and the connection still wins; closing that requires pinning the socket to the
  verified address, which Node's `fetch` does not let us do. What the DNS pass
  buys is that a name *statically* pointing at a private address is refused —
  which is the case that actually shows up.
- **A resolve is bounded** by `maxDocuments`, `totalTimeoutMs`, and `maxDepth`, so
  a hostile document cannot use the resolver as an egress amplifier, hold the
  process for hours, or crash it with nesting.

## `$id` scoping

The supported subset, chosen for the bundled-document reality rather than the
full spec:

- A subschema with `$id` is an **embedded resource**: its `$id` (resolved
  against the enclosing base) becomes the base URI for everything inside it.
- A ref whose URI — resolved against the enclosing base — **matches an embedded
  resource's `$id`** resolves to that resource without fetching. A pointer or
  anchor fragment on such a ref applies *within* that resource.
- **Anchors** bind within the resource that declares them first; an anchor not
  found in scope falls back to a document-global search (compatibility with
  documents that reference across sibling resources).
- A plain `#/pointer` fragment resolves **within the resource in scope** first,
  and falls back to the document root when it matches nothing there — which is
  the behavior bundled real-world documents rely on (a bundled OpenAPI file points
  at `#/components/schemas/…` from inside an `$id` scope). When both could match,
  the resource wins, which is the order the spec asks for.
- `$dynamicRef` prefers a `$dynamicAnchor` in scope, then degrades to `$ref`
  semantics; a pointer-form `$dynamicRef` (`#/$defs/items`) resolves exactly like
  a `$ref`, which is what the spec says it is. The full dynamic-scope algorithm
  (outermost anchor along the runtime reference chain) is not modelled, and
  cannot be by a resolver that inlines — see [Conformance, measured](#conformance-measured).
- Document **retrieval is unaffected**: which file/URL an external ref loads
  from is derived from the referencing document's *location*, never its `$id` —
  a root `$id` naming a remote URL cannot turn a local sibling-file ref into a
  network fetch.

## Conformance, measured

Inlining a document must not change what it accepts, and that is checked against
the corpus of `$ref` shapes the spec authors wrote for exactly this purpose.
`src/conformance.test.ts` takes every reference-carrying case in the official
[JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite)
(required Draft 2020-12 tests), validates the instance twice with
[`@amritk/runtime-validators`](../runtime-validators) — once through the original
schema, once through the resolved one — and requires both to agree with the spec:

**170 / 170 cases pass (100%).**

The corpus is the reference-carrying cases the interpreter already answers
correctly *before* resolution, so a disagreement afterwards is the resolver's and
nobody else's.

Getting the last ten meant *not* answering them: a `$dynamicRef` whose
`$dynamicAnchor` name is declared more than once binds at evaluation time, and
inlining collapses that to one target by construction. Those are now kept in the
output with the scaffolding they need, exactly as a reference cycle is — see
[`$id` scoping](#id-scoping) above. The expected-failure list is empty and kept in
place, so the build names the first case that regresses rather than letting a
percentage tick down. The corpus is vendored under
[`fixtures/json-schema-test-suite`](../../fixtures/json-schema-test-suite); none
of it is published.

## Documents

Every document — local file or remote — is parsed as **JSON** by default, so the
resolver stays dependency-free. Other formats plug in through the `parse` option:
`mjst lint` passes a YAML-aware parser there, which is how a `.lint.yaml`
document's cross-file `$ref`s resolve without this package depending on a YAML
parser.

## Benchmarks

`resolveRefs` memoizes: every unique `$ref` string is resolved once per scope,
with a sentinel that breaks cycles by keeping the reference node in place. But it
is no longer *only* a memoized inliner — before resolving anything it walks the
whole document once to build a resource registry (`$id`/`$anchor` scoping), keeps
recursive cycles intact, and records a diagnostic for every external ref. The
`bench/` suite pits it against a bare naive inliner that does none of that — no
registry, no scoping, no diagnostics — and re-resolves each ref on every
encounter, so the gap is the production resolver's *total* per-call cost against
the cheapest thing that produces the same inlined shape. Both are asserted to
produce byte-identical output before either is timed. Representative numbers
(Bun 1.3, Linux x64 — your hardware will differ, run `bun run bench` yourself):

| schema | cached | naive | speedup |
|:---|---:|---:|---:|
| chain (40 `$ref` → `$ref` links) | ~2.7k ops/s | ~0.77k ops/s | **~3.6×** |
| reuse-heavy (50 refs → 1 def) | ~4.2k ops/s | ~8.9k ops/s | ~0.47× |
| cyclic tree | ~32k ops/s | ~99k ops/s | ~0.32× |
| wide-distinct (60 defs, each used once) | ~2.3k ops/s | ~7.7k ops/s | ~0.29× |

Memoization overtakes the naive walk only on the **chain** shape, where a long
indirection path is expensive to re-resolve and the cache collapses it to one
pass. On every other shape here the fixed cost of the up-front registry walk (paid
once per call, no matter how the refs reuse) outweighs what memoization saves, and
the bare inliner is faster — these are small schemas where that one document walk
dominates. The takeaway is practical: the resolver's per-call floor is a full
document traversal, so in a hot loop resolve a document **once** and reuse the
result rather than re-resolving. The `reuse-heavy`, `cyclic`, and `wide-distinct`
rows are kept in the table precisely to show that trade honestly rather than
cherry-picking the one shape the cache wins.

Opting into `trackOrigins` (which records where each inlined value came from) adds
roughly **0–15%** on top, within run-to-run noise on these small schemas.
