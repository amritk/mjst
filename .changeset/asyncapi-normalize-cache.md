---
"@amritk/asyncapi": patch
---

Normalize each component schema once per extraction instead of once per message that references it. On a document where hundreds of messages share a component chain, extraction runs about twice as fast. The output does not change.
