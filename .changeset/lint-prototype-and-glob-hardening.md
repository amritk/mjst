---
'@amritk/lint': patch
---

Harden the engine against names that collide with `Object.prototype` members, and stop brace globs from exploding.

- A pointer-scoped override could set a finding's severity to a *function*: both
  the rule code and the severity name were read off the prototype chain, so
  `'constructor'` passed the membership check. Every later comparison against
  `DiagnosticSeverity.Error` then read false, so a CLI would exit 0 on a document
  it should fail. Rule codes, severity names, `then.field`, `{{template}}`
  placeholders, and `parserOptions` severities are now all own-property reads.
- `oasDiscriminator` and `oasServerVariables` tested membership with `in`, so a
  discriminator named `constructor` or a `{constructor}` server-URL template read
  as already defined and the finding went unreported.
- An override `files` glob compiled its brace groups into a cartesian product of
  concrete globs: `'{a,b}'.repeat(22)` — 110 characters — took ~40 seconds and
  built a 96 MB regex source. Groups now compile in place as regex alternations,
  which is linear in the pattern's length, and the compiled-pattern cache is
  bounded like the engine's other memoization maps.
