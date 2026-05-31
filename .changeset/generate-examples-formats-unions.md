---
"@amritk/generate-examples": minor
---

Generate dedicated fast-check arbitraries and concrete examples for more string
formats (`time`, `hostname`, `ipv4`, `ipv6`) and for multi-type schemas such as
`type: ['string', 'null']`, instead of degrading them to `fc.anything()` / `null`.
