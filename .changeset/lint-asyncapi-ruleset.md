---
'@amritk/lint': minor
---

Add an AsyncAPI ruleset at `@amritk/lint/rules/asyncapi`, covering AsyncAPI 2.0–2.6 and 3.0.

The linter has shipped an OpenAPI preset for a while; this is the same layer for
event-driven APIs, built the same way — a subpath on top of the format-agnostic
core, adding **no dependencies**:

```ts
import { lint } from '@amritk/lint'
import { createAsyncApiRuleset } from '@amritk/lint/rules/asyncapi'

const ruleset = createAsyncApiRuleset() // recommended rules, like `spectral:asyncapi`
const findings = await lint(document, { ruleset })
```

56 rules. The names match Spectral's, so an existing `.spectral.yml` that
re-severities individual rules keeps working; the one Spectral rule with no
counterpart here is `asyncapi-3-document-resolved`, for the reason below, and
two have no Spectral counterpart at all — `asyncapi-3-server-security` and
`asyncapi-3-server-variables`, which close a gap where the 3.0 Server Object's
`security` and `variables` were checked in 2.x and nowhere in 3.0. 45 of
them are gated by format,
with the 3.x-only rules under an `asyncapi-3-` prefix, because 3.0 moved
operations to the top level and tags under `info` — a 2.x document never picks up
a 3.x rule. The remaining 11 describe things both majors share (`info`, servers,
channel parameters, unused components) and run on either.

New exports: `createAsyncApiRuleset`, `resolveAsyncApiRuleset`, `asyncapi`,
`aasFunctions`, `allFunctions`, `aasFormats` (`aas2`, `aas2.0`–`aas2.6`, `aas3`,
`aas3.0`), `loadAsyncApiSchema`, `asyncApiSchemaVersion`, `ASYNCAPI_VERSIONS` and
`LATEST_ASYNCAPI_VERSION`.

Three things worth knowing:

- **The vendored meta-schemas carry three deliberate regex rewrites.** The
  official schemas contain patterns that nest unbounded quantifiers, and one of
  them —
  `^([A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*)*$` — is genuinely
  exponential: a trailing invalid character makes the match fail only after
  exploring every way to split the input. `@amritk/runtime-validators` refuses to
  compile any of them, so each is replaced by a provably equivalent pattern with
  a single unambiguous quantifier rather than by opting out of the check. The
  test suite asserts the equivalence over a generated corpus, and fails if a
  re-vendored schema reintroduces an upstream pattern.
- **Structural validation runs once, against the document as written.** There is
  one meta-schema rule per major and it is `resolved: false`, matching the
  `oas*-schema` rules. The trade-off is what a `$ref` hides: content from another
  file goes unchecked, as does a same-file reference aimed at the wrong kind of
  object — the reference itself is well-formed either way. The OpenAPI preset has
  the same gap.

- **Which tree each rule sees is chosen per rule, and pinned by a test.** A rule
  that reads what the author wrote — channel addresses, server variables, tag
  names, reference targets — runs unresolved, so a reusable definition is read at
  its declaration and nowhere else. A rule that validates schema *content* —
  payloads, headers, examples — must see the dereferenced tree, or a
  `$ref`'d schema is an opaque `{$ref: …}` it cannot judge (and, briefly, wrongly
  flagged). `ruleset-manifest.test.ts` pins the choice for all 56 rules alongside
  severity and gating.
- **The structural rules skip a version they have no schema for.** A future
  `2.7.0` document keeps getting the style rules, but is never judged against
  2.6's meta-schema.

Internally, the Server Object `variables` check and tag-name uniqueness moved to
a shared `rules/shared` module, since OpenAPI and AsyncAPI model both the same
way. `oasServerVariables` and `oasTagsUnique` keep their names, behaviour and
messages.
