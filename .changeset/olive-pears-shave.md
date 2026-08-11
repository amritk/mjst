---
'@amritk/resolve-refs': minor
---

**Behavior change:** a `$ref` whose target could not be read is now *kept* in
the resolved output instead of being inlined. Code that fed a resolved document
straight into a generator and relied on a refused ref becoming `{}` (or
vanishing) will now see an unresolved `$ref` there — which is the point: the
old shapes silently dropped every constraint on the referencing node, or
replaced it with a schema that accepts anything. `errors` is unchanged.

Fix four ways a resolve could hand back a document that is wrong rather than
incomplete.

A hoisted cycle target could overwrite a definition the output already had. The
guard against that seeded its taken-name set from the *source* root's `$defs`,
but hoists attach to the *resolved* root's — and under a pure-`$ref` root
(`{"$ref": "./b.json"}`) those are different documents, so a name free in one
was already taken in the other and the hoist silently replaced it, re-pointing
every kept `#/$defs/<name>` at the wrong schema. Names are now settled against
the object actually being written to, and the emitted ref sites are rewritten
in place so a rename cannot strand a ref.

A kept relative ref is now re-expressed against the root document. A ref like
`./c.json#/$defs/x` written in `sub/b.json` was re-emitted verbatim into a
root-based output, where it means the root's own `c.json` — a different file
that may well exist and resolve cleanly, which is the worst shape a wrong
answer can take. Refs with no file part, and refs written in the root document,
are untouched.

A `$ref` into a document that was refused or unreadable now keeps its node
instead of inlining `undefined`. An inlined `undefined` disappears on
serialization, taking every constraint on the referencing node with it, and
inside an array it becomes `null` — so `allOf: [{ $ref: <refused> }]`
serialized to `allOf: [null]`, not a schema at all. This is the trade the
budget-truncated case already made; the refused case now matches it. The
loader's own error is still the only one reported.

A class instance a custom `parse` put in value position is no longer flattened.
Value-position subtrees are deep-copied so a caller mutating its own result
cannot corrupt the session cache, but that copy rebuilt everything as plain
objects — so js-yaml's `Date` for a YAML timestamp turned `default: 2020-01-01`
into `default: {}`. A `Date` is now copied as a `Date`; any other instance is
handed back as-is rather than emptied. `JSON.parse` output is unaffected.
