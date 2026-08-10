---
'@amritk/generate-validators': patch
'@amritk/helpers': patch
---

Review follow-ups to the sibling-composition fix: three symbols the generated
output declared without reading, and a tuple type no validator would have held
anyone to.

### Unused symbols in the emitted files

All three are `noUnusedLocals` / `noUnusedParameters` errors in a consumer's
build — flags this repo holds itself to and any consumer inherits — and all three
were found by compiling the vendored OpenAPI corpus under them rather than
reasoned about. Each is an ordinary shape, not a corner:

- **`ValidationError` was imported by every generated file.** Only a body that
  *accumulates* errors names the type; a validator whose whole answer is one
  inline `return { valid: false, errors: [ … ] }` never declares the array. That
  is every scalar root — `{ "type": "string" }`, the commonest schema an OpenAPI
  document has — plus a delegating `$ref`, a `const`, an `enum` and a boolean
  root. The import is now conditional, the same way the runtime helpers beside it
  already were.
- **`const obj = input as Record<string, unknown>` was emitted by both flat
  guards regardless.** A node with no property to read guards on the shape alone
  and never touches the narrowing, so `{ "type": "object", "properties": {} }` —
  in `openai.yaml` today — declared it twice and read it neither time. The cold
  error-collecting body already had this liveness test; the exported validator's
  hot guard and `isX` now share it.

### A tuple type nothing enforced

`getTuplePositions` took the positions from a *non-empty* `prefixItems` and
otherwise fell back to the draft-07 array `items`, so an empty `prefixItems`
fell through to the array behind it: `{ "prefixItems": [], "items": [{"type":
"string"}] }` typed as `[string?, ...unknown[]]` while
`@amritk/runtime-validators` and the generated validator both read the
`prefixItems`, found no positions, and enforced nothing. A `prefixItems` that is
merely present now takes the positions there too, which is what both runtimes
already do, so the type says `unknown[]` — a widening rather than a claim. An
empty *array* `items` is unaffected: with no `prefixItems` to displace it, it is
a draft-07 tuple of no positions whose every index answers to `additionalItems`,
and the emitter validates it as such.

### Docs the audit invalidated

The audit moved three JSON Schema Test Suite cases to passing, but the numbers
quoted in prose did not move with them: the README still advertised **1271 /
1281 (99.2%)** and enumerated ten failures including two `$id`-scoping cases that
now pass. It is 1274 / 1281 (99.5%) and seven. `conformance.test.ts` now pins
both totals, so the next gap that closes fails the build instead of leaving the
package advertising a worse number than it delivers.

The README and `AI.md` also still listed "a node under `additionalItems`" among
the shapes where an `unevaluated*` refuses. That refusal is now limited to an
*inert* `additionalItems` — one with no array `items` to be the tail of, or with
a `prefixItems` that took the positions out from under it.
