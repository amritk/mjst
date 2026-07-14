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
  local). Fetched remote documents are cached for the lifetime of the process.
- **Default-deny SSRF guard.** Remote refs to loopback, private, link-local, and
  cloud-metadata (`169.254.169.254`) hosts are refused unless you opt in.
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
| `allowedHosts` | `[]` | If non-empty, only these hosts may be fetched. An explicit entry bypasses the private-host guard. |
| `allowPrivateHosts` | `false` | Allow loopback/private/link-local targets. Left off, these are refused as an SSRF guard. |
| `headers` | — | Extra headers for remote requests (record, or `(url) => headers` for per-host credentials). Never sent across a cross-origin redirect. |
| `fetch` | global `fetch` | Custom fetch implementation. The SSRF guard still evaluates every hop before it is called. |
| `timeoutMs` | `30_000` | Abort an unresponsive remote fetch after this many milliseconds. |
| `maxRedirects` | `5` | Redirect hops to follow per remote document (each hop re-runs the SSRF guard). |
| `maxBytes` | `16` MiB | Refuse to buffer a remote document larger than this. |
| `cache` | `true` | Pass `false` to bypass the process-wide session cache for this call — everything is re-fetched, nothing is stored. |
| `parse` | `JSON.parse` | Custom content parser (e.g. YAML-aware). |
| `trackOrigins` | `false` | Record a per-node origin map on the result. |

Errors (a missing file, a refused host, a bad URL) are collected on
`result.errors` rather than thrown; the corresponding ref resolves to `{}` so the
rest of the document still resolves.

`clearRemoteCache()` drops every cached remote document — useful in tests or
long-lived sessions where remote schemas may change.

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
- A plain `#/pointer` fragment stays **document-root-relative** — the behavior
  bundled real-world documents rely on — even inside an embedded resource.
- `$dynamicRef` prefers a `$dynamicAnchor` in scope, then degrades to `$ref`
  semantics. The full dynamic-scope algorithm (outermost anchor along the
  runtime reference chain) is not modelled.
- Document **retrieval is unaffected**: which file/URL an external ref loads
  from is derived from the referencing document's *location*, never its `$id` —
  a root `$id` naming a remote URL cannot turn a local sibling-file ref into a
  network fetch.

## Documents

Every document — local file or remote — is parsed as **JSON**. mjst works with
JSON Schema documents only, so this resolver stays JSON-only and dependency-free.
(The Loupe linter's sibling resolver additionally accepts YAML.)

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
| chain (40 `$ref` → `$ref` links) | ~2.6k ops/s | ~0.8k ops/s | **~3.2×** |
| reuse-heavy (50 refs → 1 def) | ~4.5k ops/s | ~8k ops/s | ~0.5× |
| cyclic tree | ~27k ops/s | ~74k ops/s | ~0.37× |
| wide-distinct (60 defs, each used once) | ~2.3k ops/s | ~7.3k ops/s | ~0.32× |

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
roughly **0–20%** on top, within run-to-run noise on these small schemas.
