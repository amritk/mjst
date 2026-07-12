---
"@amritk/runtime-validators": patch
---

Fix seven fail-open and edge-case bugs found in a validator audit:

- `multipleOf` used a `1e-8·|q|` tolerance that grew ~10⁷× larger than the
  actual floating-point error, silently accepting clear non-multiples at
  realistic magnitudes (e.g. `1000000.005` against `multipleOf: 0.01`). Integer
  divisors now use an exact `%` check (also accepting huge true multiples like
  `1e21`), and fractional divisors use an error-scaled tolerance.
- `NaN` slipped through `minimum`/`maximum`/`exclusive*` because each bound was
  written in fail-if form, where `NaN < min` is `false`. Bounds are now
  pass-condition checks, so `NaN` fails them — matching Ajv, whose `strict:false`
  oracle also rejects `NaN` against a bound. (A bare `type: 'number'` with no
  bound still accepts non-finite values, as Ajv does; `±Infinity` continues to
  follow ordinary comparison.) `multipleOf` now also rejects every non-finite
  value.
- Local `$ref` JSON Pointer resolution used the `in` operator, which walks the
  prototype chain — a mistyped pointer like `#/$defs/toString` resolved to
  `Object.prototype.toString` and was treated as an accept-anything schema.
  Resolution now uses own-property lookup and only accepts numeric index tokens
  into arrays, so unresolvable refs fail loudly.
- `deepEqual` (used by `const`/`enum`/`uniqueItems`) had no cycle guard and
  threw a `RangeError` on self-referential input; it is now depth-capped so
  cyclic values fail comparison instead of crashing the validator.
- `uniqueItems` treated `NaN` as equal on its all-primitive fast path but not on
  its structural slow path; `deepEqual` now uses SameValueZero so both agree.
- The `ipv6` format rejected the unspecified address `::`.
- `dependentRequired`/`dependentSchemas`/`dependencies` tested property presence
  with `Object.hasOwn` while `required`/`properties` used `!== undefined`, so
  `{ a: undefined }` was simultaneously absent for `required` and present as a
  dependency trigger. Presence is now uniform across all keywords.
