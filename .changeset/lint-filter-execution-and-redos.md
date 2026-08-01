---
'@amritk/lint': patch
---

Stop rulesets from executing code, and close two document-driven hangs

**A `[?(...)]` filter in a `given` is no longer JavaScript.** Filter bodies were
handed straight to `new Function`, so a `given` string in a YAML or JSON ruleset
— data, to any caller's eye — ran arbitrary code in the linting process:
`$[?(globalThis.x = {home: process.env.HOME})]` leaked the environment,
`import('node:fs')` wrote files. Filters are now parsed into a small AST and
interpreted (`@`, `@.x`, `@['x']`, `@property`, `@parentProperty`, `@parent`,
`@path`, `@root`, `$`, the comparison and logical operators, `!`, numeric
negation, string/number/boolean/null/`undefined`/`void 0` literals, regex
literals, `.length`, and a fixed list of pure methods — `indexOf`,
`lastIndexOf`, `includes`, `startsWith`, `endsWith`, `match`, `test`,
`toLowerCase`, `toUpperCase`, `trim`). Member reads see own properties only, so
`@.constructor` and `@['__proto__']` are plain `undefined`. Verified
node-for-node identical to the old evaluator on the shipped `oas` filters across
every vendored real-world spec. An expression outside the grammar is now a
ruleset error naming the rule, instead of a filter that silently matches
nothing — which also fixes filters quietly disabling themselves wherever
`new Function` is unavailable (CSP, Workers).

**The `casing` function no longer hangs on a long identifier.** `camel`/`pascal`
compiled to a pattern where digits could be consumed two ways, so a value from
the linted document could force exponential backtracking: a 46-character
`operationId` took over 100 seconds on Node (Bun's regex engine caps
backtracking, which hid it). The patterns are rewritten to be unambiguous, and
verified by brute force to accept exactly the same strings as before. Same for
the second overlap, a separator character the style already uses (`kebab` with
`separator: '-'`), which was exponential from ~40 characters.

**A deeply nested document is a diagnostic, not a crash.** `'['.repeat(20000)` —
a 40 KB file — took the process down with `RangeError: Maximum call stack size
exceeded`, while every other malformed document came back as findings. JSON
parsing now enforces the same 1000-level nesting limit `@amritk/yaml` does and
reports it as a parser diagnostic, and the JSONPath descent walker is iterative.

**Rulesets are built once, not per document.** `lintDocument` re-normalized the
ruleset and re-read every `extends` file on every call (~3.6 ms per document
with a 200-rule `extends` file; `fixDocument` paid it up to 11× per document).
The built `Ruleset` is memoized per `(definition object, basePath, restrictTo)`,
and `fixDocument` builds one for the whole loop — 200 lints of a small document
went from 750 ms to ~120 ms — so editing a ruleset file mid-run also stops
changing results half way through. Treat a definition you have passed in as
frozen; pass a fresh object to force a rebuild.

**`@amritk/lint/rules/openapi` can be bundled.** The four OpenAPI meta-schemas
were loaded through `createRequire` with a computed specifier, invisible to
bundlers (esbuild produced a 524-byte module that threw `Cannot find module
'./oas31.json'`) and unavailable on Workers and Deno. They are now generated
`.ts` modules imported statically, each holding its schema as JSON text that is
still parsed lazily on first use.

**`fixDocument` reports whether it converged.** The result gains `converged` and
`passes`, and `applied` is de-duplicated by rule code and path: two fixers that
undo each other used to report 11 applied fixes for one problem with no way to
tell a fixpoint from giving up at the pass cap.

**Also:** `alphabetical` no longer treats `'0x10'`, `'1e2'`, or `' 5'` as
numbers (they were flagged out of order though lexicographically sorted); the
module-level JSONPath, filter, and pattern caches are bounded; `extends` and
custom-function resolution accept an optional `restrictTo` root; and the ruleset
trust boundary is documented in the README and AI.md.
