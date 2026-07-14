---
"@amritk/generate-examples": patch
---

fix(generate-examples): construct `type: number` + `multipleOf` arbitraries
analytically instead of filtering random doubles. The old
`fc.double(...).filter((n) => n % m === 0)` almost never passed, so fast-check
threw "too many filtered values" at sample time. The arbitrary now draws an
integer `k` and emits `k * multipleOf`, honouring `exclusiveMinimum` /
`exclusiveMaximum` and clamping back into bounds to absorb floating-point drift.
