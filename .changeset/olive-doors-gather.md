---
'@amritk/generate': minor
---

New package: `@amritk/generate`, one surface over every mode mjst can generate.

Until now the matrix was split across two packages with two long positional
argument lists, and reaching a given cell meant knowing which package owned it.
This is the front door:

| mode | function | value back | tells you | stops at |
|:---|:---|:---|:---|:---|
| `types` | — | — | — | — |
| `guard` | `isX` | — | a boolean | the first problem |
| `validate` | `validateX` | — | every error | the end |
| `coerce` | `coerceX` | coerced | every error | the end |
| `repair` | `repairX` | repaired | repairs **and** errors | the end |
| `parse` | `parseX` | repaired | nothing | never fails |
| `parseStrict` | `parseX` | as given | throws the first | the first problem |

One options object, and a default of `['types', 'guard', 'validate']` — the modes
that only read a document. Anything that rewrites one is opt-in, because a
generator that quietly starts repairing is not one you can trust by default.
`parse` and `parseStrict` are one function name under two contracts, so asking
for both throws rather than silently picking.

**It composes the two engines, it does not replace them.** They emit genuinely
different code for the value-producing modes — a parser fuses building the output
with checking it and is several times faster for it, while a validator keeps the
passes apart and can therefore report — so collapsing them into one emitter would
mean giving up one of those properties. Both stay, and this spends the cost on
reconciling their output instead, which is bounded and testable.

What makes one output directory possible is that both derive the type from the
same `@amritk/helpers/generate-type-definition`, byte for byte. So the type is
declared **once**, in `x.ts` next to the validator half, and the parser half lands
in `x.parse.ts` importing it. There is exactly one `export type X` in the output
whatever combination of modes you ask for — asserted over a corpus of schema
shapes by compiling the result under this repo's own flags, `noUnusedLocals`
included, and then linking and calling it.
