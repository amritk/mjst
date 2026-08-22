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

55 rules, named to match Spectral's so an existing `.spectral.yml` that
re-severities individual rules keeps working. They are gated by format, with the
3.x rules under an `asyncapi-3-` prefix, because 3.0 moved operations to the top
level and tags under `info` — a 2.x document never picks up a 3.x rule.

New exports: `createAsyncApiRuleset`, `resolveAsyncApiRuleset`, `asyncapi`,
`aasFunctions`, `allFunctions`, `aasFormats` (`aas2`, `aas2.0`–`aas2.6`, `aas3`,
`aas3.0`), `loadAsyncApiSchema`, `loadResolvedAsyncApiSchema`,
`asyncApiSchemaVersion`, `ASYNCAPI_VERSIONS` and `LATEST_ASYNCAPI_VERSION`.

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
- **AsyncAPI 3.0 needs a widened schema for `resolved: true` rules.** The
  published schema does not merely allow a `$ref` for a channel's servers and an
  operation's channel and messages — it requires one, so a dereferenced document
  stops matching the schema its own spec calls valid.
  `loadResolvedAsyncApiSchema` widens exactly those four positions to "a
  Reference Object *or* the object it points at", which checks the inlined
  content while still tolerating a `$ref` a resolver deliberately left in place
  (`@amritk/resolve-refs` does that for a chain that would close a cycle).
- **The structural rules skip a version they have no schema for.** A future
  `2.7.0` document keeps getting the style rules, but is never judged against
  2.6's meta-schema.

Internally, the Server Object `variables` check and tag-name uniqueness moved to
a shared `rules/shared` module, since OpenAPI and AsyncAPI model both the same
way. `oasServerVariables` and `oasTagsUnique` keep their names, behaviour and
messages.
