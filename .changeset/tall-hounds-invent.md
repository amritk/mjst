---
'@amritk/api': minor
---

New package: contract-first, framework-agnostic API layer. Declare routes once (method, path, JSON Schemas, handler) and get typed handlers via `FromSchema`, guard-first request/response validation through `@amritk/runtime-validators` (pluggable for generated validators), OpenAPI 3.1 generation and serving with no extra code, and adapters for fetch-based frameworks (Hono, Next.js, Bun, Workers, Deno) and Node (Express, Fastify, node:http). Includes `compileToModule`, a build-time compiler that emits a fused, eval-free fetch-handler module from the same contracts — inlined guards, schema-derived serializers, precomputed OpenAPI — held observationally identical to the runtime engine by a differential test and measured faster than Hono on Cloudflare-Workers-style V8 workloads.
