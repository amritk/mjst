---
'@amritk/generate-validators': patch
'@amritk/generate-parsers': patch
---

Benchmark honesty: measure frozen inputs, and separate this repo's harness from
the moltar leaderboard's.

**Frozen inputs.** Enforcing `additionalProperties: false` means proving no
undeclared key is present, and every library answers that by enumerating keys
(mjst's guard counts them with `Object.keys(obj).length === n`; Ajv and Zod
sweep with `for...in`). On JavaScriptCore, making an object non-extensible —
`Object.freeze`, `Object.seal`, or a bare `Object.preventExtensions` — turns off
the engine's cached own-keys fast path, and every enumeration form drops to a
generic walk. Property reads are untouched, so the whole cost lands on strict
schemas. On the `assert-strict` shape that is ~185M → ~1.7M ops/s for mjst on
Bun, and it takes every other library down with it (typia ~68M → ~1.7M, TypeBox
~46M → ~1.7M, Ajv ~24M → ~1.5M). V8 has no such cliff.

Frozen config objects and frozen fixtures are ordinary inputs, so `bun run bench`
now carries `small (4 fields, frozen)` and `assert-strict (frozen)` cases — the
old suite built fresh mutable objects and could not see this at all — and
`src/generators/frozen-input.test.ts` pins the verdicts, which do not change.
The generated key count stays as it is: every alternative was measured and every
one is worse overall (`Object.values` and `Object.keys({ ...obj })` dodge the
cliff but cost 28–37× on the ordinary mutable path under JSC and 2–7× under V8,
and an `Object.isExtensible` branch costs ~4× under JSC while making V8 ~2×
slower on mutable input and ~7× slower on frozen — where there was no cliff).

**Harness.** The `assert-loose` / `assert-strict` rows share a *shape* with
`moltar/typescript-runtime-type-benchmarks`, not a harness, and the README said
so in a way that read as "we score this on that benchmark". It now says what
each number is, and `bun run bench:moltar` measures the same functions under the
leaderboard's own conditions — benny driving moltar's `Benchmark` class over its
frozen fixture, on Bun and Node, with the verdict discarded (as upstream does)
and observed, always beside a no-op control. The control is the point: on Node a
"validator" that checks nothing scores ~120M ops/s under that harness, so
mjst's ~100M `assert-loose` there is a measurement of benny, not of validation.
