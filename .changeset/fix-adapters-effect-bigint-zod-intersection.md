---
"@amritk/adapters": patch
---

Two more adapter fidelity fixes:

- **Effect**: a top-level `Schema.BigIntFromSelf` / `Schema.DateFromSelf` now
  converts to the shared `x-mjst` hint (`primitive: 'bigint'` / `instanceOf:
  'Date'`) instead of throwing, matching the Zod, Valibot, and TypeBox adapters.
  A nested unrepresentable bigint/Date now throws an actionable error pointing at
  the string-encoded `Schema.BigInt` / `Schema.Date` or a `jsonSchema` annotation.
- **Zod**: an object intersection (`z.intersection` / `.and`) emitted an `allOf`
  of two `additionalProperties: false` objects, which is unsatisfiable (each
  branch rejects the other's keys). When every `allOf` branch is a closed object
  the adapter now merges them into one object — properties unioned, `required`
  unioned, `additionalProperties: false` kept. Non-object intersections (e.g. two
  refined strings) are left as an `allOf`.
