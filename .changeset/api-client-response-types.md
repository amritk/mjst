---
'@amritk/api': minor
---

Add a family of `…Of` type helpers so apps can name their wire types straight from contracts instead of casting inline or hand-writing mirrors that drift: `ResponseBodyOf` (one declared status's schema-typed body — `type DemoLimitBody = ResponseBodyOf<typeof demoChat, 402>`), `SuccessBodyOf` / `ErrorBodyOf` (the generated-SDK-style data and error unions, split 2xx vs 4xx/5xx), `ResponseStatusOf` / `SuccessStatusOf` / `ErrorStatusOf` (the declared status domains), `RequestParamsOf` / `RequestQueryOf` / `RequestBodyOf` / `RequestHeadersOf` / `RequestCookiesOf` (the request slots, `undefined` when undeclared, mirroring what handlers see), and `ClientReplyOf` / `RouteReplyOf` (the client and handler reply unions keyed by the contract, like `ClientInput`). `ResponseBodyOf` derives from the declared schema, so a raw `contentType` status that documents a `body` schema still yields that type for callers who parse the stream themselves.
