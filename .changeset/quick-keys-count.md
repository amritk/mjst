---
"@amritk/generate-validators": patch
"@amritk/generate-parsers": patch
---

The `additionalProperties: false` fast paths count keys with `for...in` instead
of `Object.keys(obj).length === N`.

In both generators, a closed object whose declared properties are all required
proves "no undeclared key" by counting: the typed checks ahead of the count have
already proven every declared key present, so exactly N keys means no extra.
That count was `Object.keys(obj).length === N`, which builds a keys array per
call — twice per call for a nested closed object — and in the parsers carried an
`Object.getPrototypeOf(obj) === Object.prototype` guard in front of it. It is now
`let c = 0; for (const k in obj) c++; if (c !== N) …`, emitted as statements
after the typed chain in `validateX`, `isX`, the parser fast path and the shape
predicate. A `for...in` over a stable shape is answered from V8's enum cache and
allocates nothing. When a declared property is optional the presence proof does
not hold, and the per-key comparison walk is emitted as before.

Which keys the count sees: the ones `for...in` sees — the same keys the cold
paths have always swept. An enumerable key inherited from a crafted or polluted
`Object.prototype` is an extra on both paths (rejected: the safe direction); a
declared key the input inherits rather than owns satisfies both paths, whose
presence reads are `in`. The own-key count split the two: `validateX`'s guard
accepted what `validateXErrors` reported, and the parser's fast path accepted
what its cold path threw on. The parser's prototype guard existed to keep the
own-key count sound against an inherited declared key masking an own extra; a
`for...in` count sees that key too and needs no guard. Every verdict on a value
that could have come from JSON is unchanged, and the differential suites against
Ajv and `@amritk/runtime-validators` pass as before.

`bun run bench:moltar` now ends with mjst measured under upstream's own process
model — all four leaderboard cases in one process per runtime — and
`bun run bench:moltar:leaderboard` runs just that. Node 22, one process:
`assertStrict` 18.7M → 20.7M ops/s, `parseStrict` 12.5M → 13.9M; isolated per
process, `assertStrict` 21.7M → 29.4M.
