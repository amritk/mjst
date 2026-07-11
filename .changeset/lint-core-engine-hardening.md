---
'@amritk/lint': minor
---

Harden the core lint engine for Spectral compatibility and robustness. The
runner now isolates a throwing rule function into an error diagnostic instead of
aborting the run, reports an unknown named function once per rule, and awaits
Spectral-style async functions (the runner's `run` is now async). Field
targeting mirrors Spectral's `getLintTargets` (arrays are indexable, `@key`
yields indices, a field against a primitive lints the value). Findings sort by
source then position.

The JSONPath engine gains array slices (`[0:2]`, `[-1:]`, `[::2]`), the
`[(@.length-N)]` script subscript, backslash-escape handling in quoted
segments, quote-aware `@`-token substitution, `@path` materialized as the
jsonpath-plus string form, recursive `^`/`~` selectors, and loud parse errors
for malformed expressions (surfaced by `createRuleset` and `validateRuleset`).

Ruleset resolution fixes circular `extends`, resolves aliases inherited from
extended rulesets (throwing on undefined aliases), propagates `all`/`off`
modifiers through nested extends, throws when a shorthand targets a
non-existing rule, falls back an invalid severity to Warning, applies
ruleset-level `formats` per declaring ruleset, derives per-rule
`documentationUrl`, and threads `parserOptions` from extended bases. Glob
matching adds brace expansion, RegExp caching, and suffix matching of relative
patterns against absolute sources. Dead `extends`/`formats` fields are removed
from the override type.
