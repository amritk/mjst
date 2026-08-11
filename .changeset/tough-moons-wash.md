---
'@amritk/runtime-validators': patch
---

Make the declared-property presence check ask about the instance too. Every
sweep over an object's own keys was corrected, but `required`/`properties`
still tested presence with `obj[key] !== undefined`, so
`Object.create({ token: 'x' })` — a value that serializes to `{}` — satisfied
`required: ['token']` while `maxProperties: 0` and `additionalProperties: false`
agreed it had no properties at all. The fast path now needs two things, both
settled before the loop: no declared key is a prototype member (per schema, as
before) and the instance inherits nothing (one prototype read per object). That
keeps the cheap comparison for the shape that has it rather than paying
`Object.hasOwn` per declared key.

`example` joins the data keywords in `schema-registry`, matching the set in
`limits.ts` and the one `@amritk/helpers` exports.
