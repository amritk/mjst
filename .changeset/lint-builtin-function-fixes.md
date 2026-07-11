---
"@amritk/lint": minor
---

Make the built-in rule functions defensive and align them with Spectral 1.10.5:

- `casing`: report a clear finding for an unknown `type`, accept digit-leading
  segments after a separator (e.g. `foo-2fa`), and treat a lone separator char
  as valid when `allowLeading` is set.
- `xor`: no-op on missing/malformed `properties` instead of flagging every node.
- `enumeration`: no-op without a `values` array and skip non-primitive input.
- `pattern`: report an invalid regex instead of throwing, and cache compiled
  regexes.
- `schema`: surface a clearly-invalid schema as a finding, honor `allErrors`,
  and document that the dialect is auto-detected.
- `typedEnum`: honor `nullable` / `x-nullable` so a `null` enum entry is allowed.
- `alphabetical`: order integer-like keys numerically, compare numeric-string
  arrays like Spectral, and emit explicit findings for non-object / non-primitive
  items under `keyedBy`.
- `unreferencedReusableObject`: JSON-pointer-escape keys and match deep
  references so escaped and nested `$ref`s count as uses.
- `length`: no-op with no bounds and ignore non-number bounds.
- Add a new `or` built-in function (flags when none of the listed properties is
  present).
