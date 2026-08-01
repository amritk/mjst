---
'@amritk/runtime-validators': patch
---

Widen the ReDoS screen, fix five correctness defects, and cut five allocations off the hot path

**The ReDoS screen only looked where it expected schemas to be.** It walked a
fixed list of subschema keywords, so an OpenAPI-shaped document — subschemas
parked under `components/schemas` and reached by `$ref` — was declared clean and
its `pattern`s were then compiled and run unscreened. `{ $ref:
'#/components/schemas/A', components: { schemas: { A: { pattern: '^(a+)+$' } } } }`
burned ~1.3 s of CPU on a 31-character input, while the same pattern inlined at
the root was correctly rejected. The walk is now unrestricted: every
string-valued `pattern` key and every `patternProperties` key anywhere in the
document is screened, wherever it sits. Chasing `$ref`s instead would have fixed
that one layout and missed the next unfamiliar one. `const`, `enum`, `default`,
`examples` and `example` are still skipped, because a schema is allowed to carry
arbitrary data there and `{ const: { pattern: '(a+)+' } }` describes an object,
not a regex. This does cost cold build time in proportion to the document
actually being screened — an ordinary component schema is unchanged (~0.016 ms),
but handing `validate` a whole OpenAPI document now costs ~0.25 ms once, where
the old walk visited almost none of it.

**The screen's documented guarantee was false, and is now both honest and
stronger.** It claimed to "flag a few benign patterns, never the reverse", but it
only recognized *nested* unbounded quantifiers: `^(a|a)+$` is star height 1, so
it passed — and takes over a second on a 29-character input, doubling with each
added character. The screen now also rejects a provably ambiguous alternation
under an unbounded quantifier (two branches that match the same single
character), and the docs say plainly that this is a filter for recognizable
shapes, not a proof of safety — `(a|aa)+` and `a*a*$` still get through. The new
rule is deliberately sound rather than broad: the tempting "overlapping first
characters" test would flag `(ab|ac)+`, which is linear. Zero new flags across a
sweep of 27 ordinary real-world patterns.

**A deeply nested schema threw an uncatchable `RangeError`.** The pattern screen
and the `$anchor` search both recursed per schema level, and both run before
`maxDepth` applies — so 20,000 nested `{ "not": … }` levels overflowed the native
stack, `isValidationLimitError` returned `false`, and a consumer's limit handler
fell through to a 500. (At 10,000 levels it correctly threw
`ValidationLimitError`.) Both walks are now iterative with an explicit stack, so
the depth cap does its job and an anchor buried 20,000 levels down still
resolves.

**`required` was silently unenforced for prototype-member names.** The
leftover-required list was built with `k in properties`, which walks
`Object.prototype` — so `'toString' in {}` was `true`, the key looked already
covered and was dropped, and it was absent from the declared-key list too (that
comes from `Object.keys`). Nothing checked it: `{ required: ['constructor'],
properties: {} }` accepted `{}`. Ajv shares this bug by default, so the
differential fuzz could not catch it; there are explicit tests now.

**`format: 'ipv4'` accepted leading zeros** (`01.2.3.4`), the classic
octal-interpretation allowlist bypass, and the same octets are embedded in the
IPv6 grammar. **`format: 'time'` accepted a bare `12:00:00`** with no offset,
which RFC 3339 `full-time` requires. Both now match Ajv exactly.
**`minProperties`/`maxProperties` counted inherited properties** — a `for…in`
without an own-property guard — so `Object.create({ inherited: 1 })` with one own
key satisfied `minProperties: 2`.

**Five hot-path costs, measured before and after:**

- The `enum` failure message was built eagerly and thrown away in guard mode. A
  500-value enum cost 16.4k ops/s on a miss versus 5.1M on a hit — ~99% of the
  work was a discarded string. This also hit the *valid* path, because every
  non-matching `anyOf`/`oneOf` branch probe runs in guard mode: a 20-branch
  discriminated union with `enum` discriminators went 9.5k → 251k ops/s (26×).
  The miss itself is now 5.6M ops/s (340–540×).
- `contains` evaluated every element even after it had enough matches. A
  1000-element array matching at index 0 went 8.1k → 5.1M ops/s (630–740×). The early
  exit is taken only when `maxContains` is absent and no annotation scope is
  active — both need the exact total.
- `dependentRequired` / `dependentSchemas` / `dependencies` rebuilt their
  `Object.entries` on every validation. Their entry lists are now memoized on the
  per-node metadata alongside the property keys and compiled `patternProperties`,
  worth 1.3–1.9× on a one-entry keyword. An `additionalProperties`-only object
  schema also stopped allocating a throwaway empty pattern array per call (1.12×).
- `propertyNames` allocated a nine-field interpreter context per key. One scratch
  context is now reused across the key loop — safe because the only per-probe
  state is the `failed` flag and these probes cannot nest, the key being a string.
  A 20-key object gains 1.9–2.5×.
- The own-property count for `minProperties`/`maxProperties` uses
  `Object.keys().length`, which measured 92M ops/s against 19M for the old
  unguarded `for…in` and 9.5M for a `for…in` with a `hasOwn` guard — so the fix is
  also 1.14× faster than the bug.

**The per-schema validator cache is bounded.** The outer `WeakMap` collects with
the schema, but the inner `Map` keyed on mode/formats/limits lived as long as the
schema did, so a caller deriving `limits` per request pinned a validator forever:
200,000 distinct values retained 82.3 MB. Past 16 configurations it now hands
back an uncached validator (0.5 MB), which costs nothing — there is no compile
step.

**Two documentation claims corrected.** The README said valid input "and the
entire guard path allocates nothing"; branch probes, annotation trackers and
`uniqueItems` sets all allocate, so it now says what is actually true — nothing
is built for errors that never happen. And the `$ref` cycle-break comment claimed
"stopping here changes no verdict", which holds in a conjunctive position but not
inside a disjunction, where returning valid *is* a verdict.
