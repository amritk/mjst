---
'@amritk/api': minor
---

**Breaking (types):** the raw-`Response` escape hatch is now `raw(response)`
instead of a bare `Response`. Returning a `Response` directly from a handler or
guard is a type error; wrap it — `return raw(response)` — or, if you build the
reply object yourself, `return { raw: response }`. The new `raw` helper and the
`RawReply` type are exported from `@amritk/api`. Both engines still send a bare
`Response` at runtime, so handlers compiled against 0.7–0.9 keep working until
they are updated.

This fixes a silent type-inference regression introduced in 0.7.0 with the
escape hatch itself: from 0.7.0 through 0.9.0, an ordinary reply whose `status`
came from a union was rejected, even when the contract declared every one of
those statuses. The common shape is forwarding an upstream result:

```ts
type EmbedResult = { ok: true } | { ok: false; status: 502 | 503; error: string }

const embed = await triggerEmbed(...)
// 0.7.0–0.9.0: error TS2345, "Type '502' is not assignable to type '503'",
// though `responses` declares 502 and 503. Compiles again in 0.10.0.
if (!embed.ok) return { status: embed.status, body: { error: embed.error } }
```

`Response.status` is a plain `number`, so a bare `Response` in the return union
matched on `status` for every declared status and forced the reply to be
assignable to `Response` as well — reported as a misleading status mismatch.
`RawReply` (`{ readonly raw: Response }`) carries no `status`, so the reply
union's discriminant survives and such replies infer normally. Consumers who
worked around this — casting the status, splitting the return into a branch per
status, or annotating with `RouteReplyOf` — can drop the workaround.

The runtime is unchanged: `ApiResponse` already carried `raw?: Response` and the
adapters already branched on it, so the escape hatch still sends the response
verbatim, skips response validation, and strips the body for HEAD, through the
fetch adapter, the Node adapter, and the compiled engine alike. Making the
opt-out explicit at the call site is a deliberate second benefit: `raw(r)` reads
as "this reply leaves the contract" where a bare `return r` did not.
