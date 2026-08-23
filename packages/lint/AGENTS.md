# AGENTS.md — @amritk/lint

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the package instead? See
[`AI.md`](./AI.md).

A format-agnostic JSON/YAML style-guide linter: JSON Schema + custom rules,
emitting exact `line:column` findings.

## Commands

```bash
bun run --filter='@amritk/lint' test
bun run --filter='@amritk/lint' types:check
```

## Invariants — do not break these

- **The core engine is dependency-light by design:** it ships **no** `$ref`
  resolver, **no** built-in ruleset, and **no** fixers. Those are caller-injected
  (`resolve` hook, `fixers` registry, `extends` targets). Keep that separation —
  don't bake a resolver into core.
- **Two severity vocabularies:** rulesets author strings
  (`error`/`warn`/`info`/`hint`/`off`); findings carry numeric
  `DiagnosticSeverity` (0–3). Don't unify them.
- **Ranges are zero-based** `{ line, character }`. Preserve that; the `+1` for
  display is the caller's job.
- **A finding's `source`, `path` and `range` describe one node in one document.**
  A resolved rule matches the dereferenced tree, so its match path is translated
  back to the authored node before the finding is built (`locate` in
  `core/runner.ts`, over `core/pointers.ts`). Don't report a resolved-tree path:
  it names a node that need not exist, so no range resolves to it and no fixer
  can edit it. `withoutDuplicates` (`core/order.ts`) then relies on that — it
  keys on `path` as well as `range`, because a range alone cannot tell three
  absent siblings apart.
- **OpenAPI and AsyncAPI support live in the `./rules/openapi` and
  `./rules/asyncapi` subpaths**, layered on top of core — never merge either into
  the root entry. What the two genuinely share (the Server Object's `variables`,
  tag-name uniqueness) lives in `./rules/shared`, which neither subpath imports
  from the other.
- **A node's members are its own *enumerable* string keys.** Every walk in
  `core/jsonpath.ts` enumerates with `Object.keys`, so naming a key directly
  (`hasMember`, and `readMember` in `core/filter.ts`) must agree — a plain
  `Object.hasOwn` makes `query` and `queryMany` answer the same expression
  differently, because the latter seeds from one shared descent.
- **No `eval`, no `new Function`, no dynamic code construction anywhere in the
  engine.** A ruleset is data — often YAML written by someone other than the
  person running the linter — so `[?(...)]` filters are parsed into an AST and
  interpreted (`core/filter-expression.ts`, `core/filter.ts`). An expression the
  grammar does not cover must become a `CompiledPath.error` (which
  `createRuleset` throws on), never a predicate that silently matches nothing.
- **Regular expressions built from document content must be unambiguous.** The
  `casing` patterns are written so no input can be matched two ways; the
  ambiguous Spectral originals took minutes on a 46-character `operationId`.
  Check any new pattern under `node`, not `bun` — JSC caps backtracking at ~1.3 s
  and hides the problem.
- **Depth is attacker-controlled.** Walkers over document data are iterative, and
  the parsers cap nesting (`MAX_NESTING_DEPTH`) and report a diagnostic; a
  malformed document must never throw out of `lintDocument`.
- **The OpenAPI and AsyncAPI meta-schemas are generated modules.** Edit the
  vendored `.json`, then run `node scripts/generate-schema-modules.mjs`; the
  build fails on drift. Keep the imports static so the subpaths stay
  bundler-safe.
- **The vendored AsyncAPI schemas carry three deliberate regex rewrites.** The
  upstream patterns nest unbounded quantifiers — one is genuinely exponential —
  and `@amritk/runtime-validators` refuses to compile them. Each replacement is
  proven equivalent in `rules/asyncapi/schemas/schema.test.ts`; re-vendoring a
  schema without re-applying them fails that test. Never reach for
  `allowUnsafePatterns` instead.

Add a changeset for every change (`bunx changeset`).
