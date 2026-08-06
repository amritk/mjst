---
'@amritk/yaml': minor
---

Remove a quadratic scan on colon-free documents, resolve paths through aliases
and duplicated keys, and read numeric tags the same whether or not the value was
quoted.

Four fixes from a pre-release audit — a fuzz over serializer output, a
mutation fuzz (~260k documents, no crash or hang), and a run of structural
invariants over the official test suite plus the vendored real-world specs.

**A large colon-free document cost O(n²).** Finding the `: ` a plain scalar may
not contain was handed to `indexOf`, which cannot be told where to stop and so
searched to the end of the *document* rather than to the end of the scalar. Any
document with a long colon-free tail — a list of hostnames, package names, an
allow-list — paid the full remaining length once per entry. A 1.4 MB list of
80,000 plain scalars took 700 ms, and four times that at twice the size; it is
now 28 ms and linear. The scan is bounded by the scalar's own text, which per
character is the comparison `indexOf` was already doing, so throughput on real
specs is unchanged. A 300,000-entry case pins it: a quadratic scan cannot finish
inside the test's timeout.

**`nodeAtPath` could not walk through an alias.** `required: *ref` pointing at a
sequence is how specs share a list — OpenAI's public OpenAPI document does it
twice — and `toJS()` expands it, so `['…', 'required', 0]` addresses a real
value. Every path underneath an aliased collection returned `undefined` anyway,
or, with `closest`, the wrong ancestor's span. Aliases are now followed on the
way down, resolving to the node inside the anchored definition; a path that
*ends* on the alias still returns the alias node, so a diagnostic points at the
`*ref` the document wrote rather than at the distant anchor.

**`nodeAtPath` resolved a duplicated key to the shadowed pair.** `toJS()`
assigns pairs in order, so the last one written is the value the caller holds —
the rule `JSON.parse` follows and what `uniqueKeys: false` documents — while the
lookup returned the first match, pointing a diagnostic at a value nobody is
looking at. It now scans back to front.

**`!!int` / `!!float` on a quoted number lost the tag's meaning.** The coercion
went through `parseInt`, which stops at the `x` of `0x1F` unless told base 16,
and `parseFloat`, which reads `.inf` as `NaN`. So `!!int "0x1F"` came back as
`0` where the unquoted `!!int 0x1F` came back as `31`, and `!!float ".inf"`
stayed a string. Quoting no longer changes what a tag means: the text goes
through the core schema first, matching both `yaml` (eemeli) and `js-yaml`.

Diagnostics now arrive in **source order**. A duplicate-key report is raised
after its value has been parsed, so it used to land behind problems found inside
that value even though the key comes first — a consumer showing "the first
error" named the wrong one.

Documentation catches up with two behaviors that were true but unstated: `parse()`
and `toJS()` do throw on a resource-exhaustion document (runaway alias expansion
or nesting too deep to project), which the `parse` JSDoc previously denied
outright; and a path resolves to no node when the key was written with no value
(`paths:` → `null`) or was brought in by a `<<` merge, both of which fall back to
the holding map under `closest`.
