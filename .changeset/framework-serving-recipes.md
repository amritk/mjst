---
'@amritk/api': patch
---

Document a serving recipe for every major server framework, and add a table of
contents to the README that links to each one.

The package already reaches every JavaScript server through two adapters —
`toFetchHandler` for hosts speaking `Request`/`Response` and `toNodeHandler`
for `req`/`res` — but only a few of them had wiring written down. The README's
"Serving it" section now covers Bun, Cloudflare Workers, Deno, Hono, Next.js,
SvelteKit, Nitro/Nuxt, Elysia, `node:http`, Express, Fastify, Koa, and NestJS,
each with the details that are easy to get wrong: Fastify needs a global
`onRequest` hook plus `reply.hijack()` (it routes before hooks, and the body is
still unread at that point), Koa needs `ctx.respond = false`, Express 5 changed
its wildcard syntax, and whatever the host passes as its second argument lands
in `createApi({ context })` as `env`. A new integration test runs the Express,
Fastify, and Koa recipes against the real packages so they cannot rot.

No runtime code changed.
