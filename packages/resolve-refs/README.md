# @amritk/resolve-refs

Resolve and inline JSON Schema / OpenAPI `$ref`s — internal pointers, cross-file
refs, and remote (http/https) documents — into a single dereferenced document.

- **One-pass, cached.** Every unique ref is resolved once; cycles are broken with
  an empty object so the result is always finite.
- **Anchors + dynamic refs.** Beyond JSON-pointer `$ref`s, plain-name `$anchor`
  references (`#node`), `$dynamicRef`/`$dynamicAnchor` (2020-12), and
  `$recursiveRef`/`$recursiveAnchor` (2019-09) are dereferenced too. The dynamic
  forms bind to their document-global anchor — the single-bundle case; nested
  `$id` base-URI re-scoping is not modelled.
- **Cross-file + remote.** Relative refs resolve against the document they appear
  in (a ref inside a remote doc stays remote, one inside a local file stays
  local). Fetched remote documents are cached for the lifetime of the process.
- **Default-deny SSRF guard.** Remote refs to loopback, private, link-local, and
  cloud-metadata (`169.254.169.254`) hosts are refused unless you opt in.

## Usage

```ts
import { resolveRefs, resolveRefsFromFile } from '@amritk/resolve-refs'

// In-memory, internal (#/...) refs only:
const { resolved } = resolveRefs(myDocument)

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

Errors (a missing file, a refused host, a bad URL) are collected on
`result.errors` rather than thrown; the corresponding ref resolves to `{}` so the
rest of the document still resolves.

`clearRemoteCache()` drops every cached remote document — useful in tests or
long-lived sessions where remote schemas may change.

## Documents

Every document — local file or remote — is parsed as **JSON**. mjst works with
JSON Schema documents only, so this resolver stays JSON-only and dependency-free.
(The Loupe linter's sibling resolver additionally accepts YAML.)

## Benchmarks

`resolveRefs` is single-pass: every unique `$ref` string is resolved exactly
once and memoized, with a sentinel that breaks cycles. The `bench/` suite isolates
what that memoization buys by pitting it against a naive inliner that re-resolves
each ref every time it is encountered — same inlined output, the cache is the only
difference. Representative numbers (Bun 1.3, Linux x64 — your hardware will
differ, run `bun run bench` yourself):

| schema | cached | naive | speedup |
|:---|---:|---:|---:|
| reuse-heavy (50 refs → 1 def) | ~35k ops/s | ~6k ops/s | **~5.8×** |
| chain (40 `$ref` → `$ref` links) | ~5k ops/s | ~0.6k ops/s | **~8.2×** |
| cyclic tree | ~122k ops/s | ~117k ops/s | ~1.05× |
| wide-distinct (60 defs, each used once) | ~3.3k ops/s | ~6.1k ops/s | ~0.54× |

The cache earns its keep exactly where you'd expect: a `$def` referenced from
many sites, or a long indirection chain, is resolved once instead of re-walked
every time. On a document where every ref is distinct — so the cache never hits —
its bookkeeping is pure overhead and the naive walk is faster; that `wide-distinct`
row is kept in the table precisely to show the trade honestly. Real API schemas
lean heavily on shared `$def`s, which is the case the resolver is tuned for.

Opting into `trackOrigins` (which records where each inlined value came from) adds
roughly **5–20%** on top. Both strategies are asserted to produce byte-identical
output before either is timed.
