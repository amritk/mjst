---
'@amritk/mjst': minor
---

Let a ruleset file extend a built-in lint preset.

`mjst lint` only consulted its preset table for a literal `--ruleset asyncapi`.
A `.lint.yaml` saying `extends: [asyncapi]` — discovered automatically, or passed
as `--ruleset ./.lint.yaml` — failed with `Cannot resolve extended ruleset
"asyncapi"`, so there was no way to layer project rules on top of a preset from
a config file.

Both presets (`asyncapi`, `oas`) and both aliases (`loupe:`, `spectral:`) now
resolve through either path, and the preset's own functions and format detectors
come with them, which a definition alone cannot carry. Relative `extends` and
custom `functions` still resolve next to the ruleset file. A ruleset extending
*both* presets is refused with a message saying why, instead of a resolution
failure from inside the resolver.
