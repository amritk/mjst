# AsyncAPI structural meta-schemas

These are the official AsyncAPI JSON Schema documents from
[`asyncapi/spec-json-schemas`](https://github.com/asyncapi/spec-json-schemas),
vendored as raw `.json` files. `scripts/generate-schema-modules.mjs` turns each
one into the sibling `.ts` module that [`index.ts`](./index.ts) imports — a
static import so the package can be bundled, and so it runs where
`createRequire` does not exist (Workers, Deno). The build fails if a `.json`
file and its module drift apart. They back the `asyncapi-schema` and
`asyncapi-3-document-unresolved` rules, and the AsyncAPI Schema
Object subschema each one carries backs `asyncapi-payload`.

| File | Version | Source |
| --- | --- | --- |
| `aas20.json` | 2.0.0 | `https://raw.githubusercontent.com/asyncapi/spec-json-schemas/master/schemas/2.0.0.json` |
| `aas21.json` | 2.1.0 | …`/schemas/2.1.0.json` |
| `aas22.json` | 2.2.0 | …`/schemas/2.2.0.json` |
| `aas23.json` | 2.3.0 | …`/schemas/2.3.0.json` |
| `aas24.json` | 2.4.0 | …`/schemas/2.4.0.json` |
| `aas25.json` | 2.5.0 | …`/schemas/2.5.0.json` |
| `aas26.json` | 2.6.0 | …`/schemas/2.6.0.json` |
| `aas30.json` | 3.0.0 | …`/schemas/3.0.0.json` |

Every file is byte-for-byte upstream apart from the three regex adaptations
below, so a diff against the source URL shows exactly four or five changed
lines.

## Why these run without a dialect engine

`@amritk/runtime-validators` is a JSON Schema 2020-12 interpreter that resolves
**local** references but never fetches remote documents. The AsyncAPI schemas
are draft-07 and refer to their own subschemas by absolute URI
(`http://asyncapi.com/definitions/3.0.0/info.json`) rather than by JSON
Pointer — but every one of those URIs is an `$id` declared inside the same
document, so the interpreter resolves them from its own resource registry with
nothing to fetch. The draft-07 `definitions` keyword and the draft-07
metaschema the documents embed for `schemaFormat` support come along
unchanged.

## Adaptation: three ReDoS-prone patterns

The upstream schemas carry three regular expressions that
`@amritk/runtime-validators` rejects outright, because they nest unbounded
quantifiers and are applied to attacker-controlled document content. One of the
three is genuinely exponential; the package refuses to build a validator from
any of them rather than guess. Each is replaced here by a **provably equivalent**
pattern that matches the same language with a single, unambiguous quantifier —
`schema.test.ts` asserts the equivalence over a generated corpus.

| Upstream | Vendored | Why |
| --- | --- | --- |
| `^([A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*)*$` | `^(?:[A-Za-z_](?:[A-Za-z0-9_]\|\.[A-Za-z_])*)?$` | The real ReDoS. The outer `*` repeats a group that can itself match a bare identifier, so `aaaa…` splits exponentially many ways and a single trailing invalid character makes the match fail only after exploring all of them. Concatenating two dotted chains always yields another dotted chain, so the outer star adds nothing beyond "or empty". |
| `^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$` | `^[A-Za-z_](?:[A-Za-z0-9_]\|\.[A-Za-z_])*$` | Safe in practice — each repetition must start with `.`, which `[A-Za-z0-9_]*` cannot consume — but it still nests unbounded quantifiers, which is what the checker screens on. Rewritten as one flat loop over "identifier character, or a dot that starts a new identifier". |
| `^\$message\.(header\|payload)#(\/(([^\/~])\|(~[01]))*)*` | `^\$message\.(header\|payload)#(?:\/(?:[^~]\|~[01])*)?` | Same story: each outer repetition must start with `/`, which the inner class excludes, so it cannot loop on empty — but it nests. After the first `/`, later `/`s only open new repetitions, so the tail is just "any run of non-`~` characters and `~0`/`~1` escapes". |

## Refreshing

Re-download the files from the source URLs above, re-apply the three
substitutions in the table (they appear 4–5 times per file), then regenerate
the modules and commit both the `.json` and the `.ts`:

```sh
cd packages/lint && node scripts/generate-schema-modules.mjs
```

`schema.test.ts` fails if a re-vendored file reintroduces a pattern the
validator rejects, so a missed substitution cannot land silently.
