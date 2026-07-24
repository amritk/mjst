---
"@amritk/runtime-validators": minor
"@amritk/api": patch
"@amritk/adapters": patch
"@amritk/helpers": patch
---

`FromSchema` now honours the `x-mjst` `brand` hint, so branded ids reach the API
boundary.

- **`@amritk/runtime-validators`** — a schema carrying
  `'x-mjst': { brand: 'UserId' }` now infers `Base & { readonly __brand: 'UserId' }`
  (e.g. `string & …`), matching the `.d.ts` shape the code generators already
  emit. Branding stays type-level only — runtime validation still checks the
  plain base type — and `null` remains assignable when a `nullable` schema is
  branded.
- **`@amritk/api`** — because route `params` / `query` / `body` are typed through
  `FromSchema`, a branded param schema now flows a nominal id into the handler and
  the derived typed client, so a `UserId` can't be passed where an `OrderId` is
  expected. The same protection Drizzle's `.$type<UserId>()` gives a column, at
  the API boundary.
- **Docs** — the `x-mjst` reference now documents the `brand` hint (a new
  "Nominal brands" section in `@amritk/adapters`), with recipes in the
  `@amritk/api` README/AI.md and the `@amritk/runtime-validators` type-inference
  docs, plus the `mjst-extension` subpath in `@amritk/helpers`.
