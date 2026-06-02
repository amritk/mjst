---
"@amritk/yaml": minor
---

Resolve the common extended `!!` tags, matching `yaml` (eemeli): `!!binary` →
`Uint8Array`, `!!timestamp` → `Date`, `!!set` → `Set`, and `!!omap` → `Map`.
These coerce only on an explicit tag, so an untagged ISO date string still
resolves to a string. Flow sequences now accept implicit single-pair-map
entries (`[ key: value ]`), the shape `!!omap` is written in.

Tabs used for indentation are now reported as a `TAB_INDENT` error with an exact
source span, instead of being silently mis-parsed. Tab indentation remains
unsupported (it is forbidden by YAML 1.2); detection costs one comparison per
line, so the per-character scanning hot path is unchanged.
