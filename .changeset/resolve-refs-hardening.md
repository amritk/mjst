---
'@amritk/resolve-refs': minor
---

**Behavior change:** a `$ref` whose target could not be read is now *kept* in
the resolved output instead of being inlined. Code that relied on a refused ref
becoming `{}` (or vanishing) will now see an unresolved `$ref` there — which is
the point: the old shapes silently dropped every constraint on the referencing
node, and inside an array `undefined` became `null`, so
`allOf: [{ $ref: <refused> }]` serialized to `allOf: [null]`, not a schema at
all. `errors` is unchanged. Note that a ref the SSRF or `allowedRoots` guard
refused stays in the output too — the guard is this resolver's, so handing the
result to a second, unguarded resolver reopens the question it answered.

Alongside that, six ways a resolve could hand back a document that is wrong
rather than incomplete:

A hoisted cycle target could overwrite a definition the output already had. The
guard seeded its taken-name set from the *source* root's `$defs`, but hoists
attach to the *resolved* root's — different documents under a pure-`$ref` root
— so the hoist silently replaced a definition and re-pointed every kept
`#/$defs/<name>` at the wrong schema. Names now settle against the map actually
written to, with the emitted ref sites rewritten in place.

A kept relative ref is re-expressed against the root document. `./c.json`
written in `sub/b.json` was re-emitted verbatim into a root-based output, where
it names the root's own `c.json` — a different file that may well exist and
resolve cleanly. All four sites that keep a reference now share one
implementation, so a fix to one cannot miss the others. Refs carrying a scheme
(`urn:`, `http:`) are left alone, and a bare fragment is pointed back at the
document that wrote it. `$dynamicRef` and `$recursiveRef` are never rebased —
those carry an anchor name, not a location.

A subtree the depth limit hands back whole is rebased the same way, with the
resolver's own role walk so a `$ref` sitting in `enum`/`const`/`default`
instance data is left as the literal the author wrote, and with a visited set —
`detach` preserves cycles deliberately, and without one a cyclic document from
a non-root file never returned at all.

A class instance a custom `parse` put in value position is no longer flattened:
value-position subtrees are deep-copied so a caller cannot corrupt the session
cache, but that copy rebuilt everything as plain objects, so js-yaml's `Date`
for a YAML timestamp turned `default: 2020-01-01` into `default: {}`.

OpenAPI 3.0's singular `example` now counts as instance data, so a `$ref` inside
an example value is no longer inlined over the literal the author wrote.
