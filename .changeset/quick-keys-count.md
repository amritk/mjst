---
"@amritk/generate-validators": minor
"@amritk/generate-parsers": minor
"@amritk/mjst": minor
"@amritk/helpers": minor
---

Nested objects are hoisted into a local on every fast path, and how a closed
object proves it has no undeclared key is now an option: `unknownKeys`.

**Hoisting.** The validators' `isX` / `validateX` guards used to read every
member of a nested object through a fresh cast — `typeof (obj.deeplyNested as
Record<string, unknown>).foo`, once per member, plus twice more for the key
count. They now load each nested object once, `const _n0 = obj.deeplyNested as
Record<string, unknown>`, guard it with `typeof _n0 === 'object' && _n0 !==
null` before the first member read, and read every member (and count every key)
through the local, at any depth, for required and optional nested objects and
for object array items alike. V8 had already commoned the loads; on
JavaScriptCore the local is what lets the guard be optimised at all — under the
moltar harness `isAssertStrict` on Bun 1.4 goes from ~45M ops/s to the harness
floor (~300M on the measuring box, the call eliminated). A guard that hoists
or counts is now a run of early exits (`if (!(…)) return …`) rather than one
nested `&&` chain.

The parsers already read nested objects through cached locals, but their fast
path proved a nested object with a *call* — `validateDoc_NestedShape(_nested)` —
and that call was the one thing left on the strict fast path JavaScriptCore
would not see through. The parent's guard now spells the nested predicate out
over the local (`typeof _nested === "object" && … && Object.keys(_nested).length
=== 2`), built from the shape validator's own checks so the two cannot disagree,
one level deep and within the same size budget as the strip-build inlining.
`parseStrict` under the moltar harness on Bun 1.4 goes from ~45M ops/s to the
harness floor, and Node gains the saved call (~10%). The call stays where the
predicate is not one expression: a per-key walk, a `for…in` count under
`count-enumerable`, or a nested object past the budget.

**`unknownKeys: 'count-keys' | 'count-enumerable'`** — on `buildSchema` (15th
positional), `buildValidatorSchema` (5th), and the CLI (`--unknown-keys`, or
`unknownKeys` in the config file). `'count-keys'` is `Object.keys(obj).length
=== N` (in the parsers behind an `Object.getPrototypeOf(input) ===
Object.prototype` guard, which keeps an own-key count sound against an inherited
declared key); `'count-enumerable'` is `let c = 0; for (const k in obj) c++`,
which allocates nothing and needs no prototype guard. When a declared property is
optional both fall back to the per-key `for…in` walk. The two trade places
between engines, measured under the moltar harness (Bun 1.4.0 / Node 22, each
case alone in its own process): `assertStrict` ~300M / 19M ops/s with
`count-keys` against 22M / 22M with `count-enumerable`; `parseStrict` ~220M /
14M against 13M / 14M. The default is **`'count-keys'`** — mjst benches on Bun,
where it is never the slower form and is 3× faster on the strict parse.
Node-only consumers gain from `'count-enumerable'` (10–20% on that box, up to
1.7–2× on faster hardware). The choice is made at generation time; the emitted
code never detects its runtime.

Every verdict on a value that could have come from JSON is unchanged under
either strategy, and the differential suites against Ajv and
`@amritk/runtime-validators` pass as before. The two strategies do read
different key sets on a value JSON cannot hold (an enumerable key on a crafted
prototype): `for…in` agrees with the cold paths exactly, `Object.keys` accepts an
inherited extra the cold path would report — which is what `main` always did.

`@amritk/helpers` gains `unknown-keys-strategy` (the type, the list, the default
and a guard), shared by both generators and the CLI. `bun run
bench:moltar:leaderboard` prints one row per strategy for every runtime it
finds, so both variants are measured side by side.
