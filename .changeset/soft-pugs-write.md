---
'@amritk/generate-validators': patch
---

Docs: correct two invariants that had gone stale, and write down what the
generator refuses.

`AGENTS.md` and `AI.md` both said `NaN` satisfies numeric bounds and differs from
Ajv. It has not for some time: every bound is emitted as the negated pass
condition, so `NaN` fails a *constrained* number and satisfies a bare
`{ "type": "number" }` — which is Ajv's answer too, and the interpreter's, pinned
value-by-value in `interpreter-parity.test.ts`. `AGENTS.md` also still said
`unevaluatedProperties` / `unevaluatedItems` throw, where they have been generated
(with four named refusing shapes) for a while.

The README gains the names generation will not emit, and a note on the values
JSON cannot hold — an `undefined` at a swept key, a hole in a sparse array, `NaN`
under `const` / `enum` / `uniqueItems`, and a self-referential object — each of
which now answers the way the interpreter and Ajv answer.
