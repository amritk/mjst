---
'@amritk/parsers': minor
---

New package: `@amritk/parsers`, one surface over every mode mjst can generate.

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

**It is not faster, and it should not be.** Ask it for one mode and it emits the
exact bytes the package that owns that mode would have emitted, which is pinned
per mode by fingerprint. Identical code cannot run at a different speed, so there
is no runtime claim here. What changes is cold: the whole matrix costs slightly
less to generate (2.9 ms → 2.7 ms), lands in six files instead of seven, and
declares the type once instead of twice. A build that asks for no validator mode
now also ships no `validation-result.ts`, where composing by hand would have left
17 KiB of error types nothing could import.


Also: the rehoming step recognises a sibling import by regex rather than by the
obvious `line.includes("from './")`. `tsc-alias -f` rewrites that literal in the
compiled output — it cannot tell a string that merely looks like an import
specifier from a real one — turning the predicate into one that is never true.
Nothing failed loudly, because every test in this repo aliases workspace packages
to `src`; the suite stayed green while the built package emitted parser files
importing names from the validator file that does not export them. A dist-level
smoke test now asserts the built artifact still rehomes, since only running the
built code can catch it.
