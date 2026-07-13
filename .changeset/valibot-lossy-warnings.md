---
"@amritk/adapters": minor
---

Bring the Valibot adapter to parity with Zod for lossy conversions, and add an
opt-in strict mode to both.

- The Valibot adapter previously ran `@valibot/to-json-schema` in
  `errorMode: 'warn'` and let that library log widening in its own words, one
  line per construct — from mjst's side, Valibot widening was effectively
  invisible. It now runs the converter in `errorMode: 'ignore'`, collects the
  constructs it could not represent (unrepresentable schema types that degrade
  to an open schema, plus refinements like flagged regexes that JSON Schema
  cannot express) via the converter's override hooks, and emits a single
  batched, `[mjst]`-branded `console.warn` — the same style the Zod adapter
  already uses. `date` and `bigint` remain rescued into the shared `x-mjst`
  hint and are never reported as lossy.
- Both `zodToJsonSchema` and `valibotToJsonSchema` now accept an
  `{ strict?: boolean }` options argument (surfaced on the shared `Adapter`
  type as `AdapterOptions`). In strict mode a construct that cannot be fully
  represented throws instead of silently widening the generated type.
