# OpenAPI fixtures

Vendored, real-world OpenAPI documents fetched from across the web. They give
the whole monorepo a shared, varied corpus to test against — the YAML parser,
the `$ref` resolver, the runtime validator, and every code generator are all
exercised on these same documents (see the `*openapi-fixtures*` tests in each
package, and `packages/yaml`'s differential suite).

The corpus deliberately spans:

- **Versions:** OpenAPI 3.0.x and 3.1.x.
- **Formats:** YAML and JSON.
- **Sizes:** a few hundred bytes up to multi-megabyte real-world specs.
- **Features:** callbacks, links, webhooks, non-OAuth security scopes,
  recursive schemas, discriminators, and `allOf`/`oneOf`/`anyOf` composition.

These files live outside any package's `src/` (and outside the published
`files` list), so they are never shipped. They are kept **pristine** —
byte-for-byte as fetched — so what we parse matches what the upstream publisher
actually serves.

| File | Source | License |
| --- | --- | --- |
| `v3.0/api-with-examples.yaml` | [`OAI/learn.openapis.org`](https://github.com/OAI/learn.openapis.org) — `examples/v3.0/api-with-examples.yaml` | CC BY 4.0 |
| `v3.0/callback-example.yaml` | [`OAI/learn.openapis.org`](https://github.com/OAI/learn.openapis.org) — `examples/v3.0/callback-example.yaml` | CC BY 4.0 |
| `v3.0/link-example.yaml` | [`OAI/learn.openapis.org`](https://github.com/OAI/learn.openapis.org) — `examples/v3.0/link-example.yaml` | CC BY 4.0 |
| `v3.0/petstore.yaml` | [`OAI/learn.openapis.org`](https://github.com/OAI/learn.openapis.org) — `examples/v3.0/petstore.yaml` | CC BY 4.0 |
| `v3.0/petstore-expanded.yaml` | [`OAI/learn.openapis.org`](https://github.com/OAI/learn.openapis.org) — `examples/v3.0/petstore-expanded.yaml` | CC BY 4.0 |
| `v3.0/uspto.yaml` | [`OAI/learn.openapis.org`](https://github.com/OAI/learn.openapis.org) — `examples/v3.0/uspto.yaml` | CC BY 4.0 |
| `v3.1/non-oauth-scopes.yaml` | [`OAI/learn.openapis.org`](https://github.com/OAI/learn.openapis.org) — `examples/v3.1/non-oauth-scopes.yaml` | CC BY 4.0 |
| `v3.1/webhook-example.yaml` | [`OAI/learn.openapis.org`](https://github.com/OAI/learn.openapis.org) — `examples/v3.1/webhook-example.yaml` | CC BY 4.0 |
| `v3.1/tictactoe.yaml` | [`OAI/learn.openapis.org`](https://github.com/OAI/learn.openapis.org) — `examples/v3.1/tictactoe.yaml` | CC BY 4.0 |
| `real-world/swagger-petstore.json` | [Swagger Petstore](https://petstore3.swagger.io/api/v3/openapi.json) — `swagger-api/swagger-petstore` | Apache-2.0 |
| `real-world/digitalocean.yaml` | [`digitalocean/openapi`](https://github.com/digitalocean/openapi) — `specification/DigitalOcean-public.v2.yaml` | Apache-2.0 |
| `real-world/openai.yaml` | [`openai/openai-openapi`](https://github.com/openai/openai-openapi) — `openapi.yaml` | MIT |

To refresh a fixture, re-fetch it from its source URL and commit the result.
