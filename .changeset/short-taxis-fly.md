---
'@amritk/lint': patch
---

Use the shared `assignKey`/`readKey` from `@amritk/helpers` instead of
hand-written copies. The `__proto__`-safe write and the own-property read had
each been restated locally — in `ruleset.ts` and in `oasPathParam` — beside a
comment re-explaining the same hazard. `@amritk/lint` already depends on
`@amritk/helpers`, and one implementation is what keeps the next call site from
quietly omitting the guard.
