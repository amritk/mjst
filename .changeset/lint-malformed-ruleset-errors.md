---
'@amritk/lint': patch
---

Report a malformed ruleset entry by name instead of crashing with a `TypeError`.

A rule written `my-rule:` with no body is `null` in YAML, and the author was told
"Cannot read properties of null (reading 'severity')". Seven more shapes failed
the same way — a rule entry that is a number or an array, an override entry that
is `null`/`undefined`/a number, a rule with no `given`, a `given` that is not a
string. Each is now a named error raised while the ruleset is built:

- `Rule "my-rule" must be a rule definition, a boolean, or a severity — got null`
- `Rule "my-rule" is missing \`given\``
- `Rule "my-rule" has an invalid \`given\`: expected a JSONPath string, got \`number\``

Malformed *override* entries are checked at build time too; because overrides
apply per document, they previously surfaced from the middle of a lint run.

A file-glob override may now also give a severity as its numeric LSP level
(`{ 'my-rule': 1 }`), which is what the pointer-scoped override path already
accepted; it used to be misread as a full rule definition.

Also adds a seeded fuzz sweep that crosses random rulesets with awkward
documents and asserts the engine never fails in a way it cannot explain.
