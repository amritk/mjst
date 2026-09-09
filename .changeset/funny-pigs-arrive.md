---
---

Fix the benchmark's parity check, which had been failing open

`bench/worker.ts` calls `isDeepStrictEqual` to compare a parser's output against
the case's expected value, but never imported it. The `ReferenceError` that threw
was caught by the surrounding `try`/`catch`, whose whole purpose is to report a
disagreement rather than abort — so the output half of every parity check
reported failure, for every case and every library, and had done so silently.

The visible symptom was a `⚠parity` marker ("a correctness disagreement") on all
six `parsers` rows of the benchmark comparison table, on `main` and on every
branch alike. The real cost is that the guard was inert: a change that made a
generated parser return the wrong object would have produced exactly the same
table.

`bench/` is not covered by the package's `types:check` (its `include` is
`src/**/*.ts`), which is why an undefined identifier survived there. Widening
that include surfaces a pile of unrelated pre-existing errors — Bun globals,
TypeBox typings, an untyped `.mjs` import — so it is left alone here.

With the import in place all 18 case/library pairs report `strip✓ reject✓` /
`keep✓ reject✓`.
