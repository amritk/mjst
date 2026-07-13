---
---

docs: add a README to `@amritk/adapters`. Documents per-library usage and the required optional peer deps (Zod 4+, Valibot + `@valibot/to-json-schema`, Effect 3+, TypeBox none), the Zod-4-only constraint, the shared `x-mjst` Date/bigint mappings, the lossy-construct widening behaviour and per-library warnings, the Effect encoded-representation caveat (`Schema.Date` → `string`; only `*FromSelf` becomes a runtime type), and the TypeBox extended-type map covering only Date/bigint.
