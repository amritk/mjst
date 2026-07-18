---
'@amritk/api': minor
---

Add `ResponseBodyOf` and `ClientReplyOf` type helpers so apps can name response wire types straight from their contracts — `type DemoLimitBody = ResponseBodyOf<typeof demoChat, 402>` — instead of casting bodies inline at every use site. `ResponseBodyOf` derives from the declared schema (a raw `contentType` status that documents a `body` schema still yields that type, for callers who parse the stream themselves); `ClientReplyOf` names the discriminated reply union a client method resolves with, keyed by the contract like `ClientInput`.
