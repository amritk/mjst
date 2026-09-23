---
"@amritk/generate-examples": patch
---

Fix derived examples for an integer with a very small `multipleOf`. A step below 1e-9 was taken as 0, which produced `NaN` (serialized as `null`), and a step finer than 1e-4 fell back to rounding a fractional value across its bounds. The integer step is now read off the decimal spelling of `multipleOf` (`1e-10` steps by 1). A number on a fractional `multipleOf` grid also no longer drifts past its bound: `{ minimum: -0.3, multipleOf: 0.1 }` gives `-0.3`, not `-0.30000000000000004`.
