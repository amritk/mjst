---
'@amritk/yaml': patch
---

Assert the alias-expansion budget ceiling directly instead of by wall clock.

The ceiling test built a 2.7 MB padded alias bomb, projected it, and used a 5s
timeout as its assertion. That only ever worked by accident: the cap does not
change *whether* a bomb throws, only how much it materializes first, so
end-to-end the sole observable is the clock — and `bun run test` fans out one
vitest per package, which is the contention `vitest.config.ts` already raised
`testTimeout` to 30s for. The test overrode it back to 5s and went red under the
fan-out while passing in 1.5s on its own, at a cost of 350 MB resident.

It now asserts the ceiling on `newExpansionBudget` — flat past the point where
the cap binds, and a fraction of the per-byte allowance — which is deterministic,
catches the same regression (removing the `Math.min` fails it), and takes 14 ms.
That a bomb throws at all stays covered end-to-end by the billion-laughs test.
`newExpansionBudget` and `ExpansionBudget` are now exported from
`parse-document.ts` for it; neither is re-exported from the package index, so the
public API is unchanged.
