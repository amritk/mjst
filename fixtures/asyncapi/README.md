# AsyncAPI fixtures

Vendored, real-world AsyncAPI documents, kept alongside the OpenAPI corpus so
the event-driven side of the tooling gets the same treatment: the YAML parser,
the `$ref` resolver and the `@amritk/lint` AsyncAPI ruleset all run against
these same documents.

The corpus deliberately spans:

- **Versions:** AsyncAPI 2.6.x and 3.0.x, including the same API modelled in
  both — the two majors restructured channels, operations and messages, so a
  matched pair is what catches a rule that was gated to the wrong one.
- **Protocols:** Kafka, MQTT, WebSocket and HTTP streaming.
- **Features:** message traits, `oneOf` message alternatives, correlation IDs,
  channel parameters, security schemes with OAuth2 scopes, and `$ref` reuse
  through `components`.

These files live outside any package's `src/` (and outside the published
`files` list), so they are never shipped. They are kept **pristine** —
byte-for-byte as fetched — so what we parse matches what the upstream publisher
actually serves.

| File | Source | License |
| --- | --- | --- |
| `v2.6/correlation-id.yaml` | [`asyncapi/spec`](https://github.com/asyncapi/spec) — `v2.6.0` `examples/correlation-id.yml` | Apache-2.0 |
| `v2.6/gitter-streaming.yaml` | [`asyncapi/spec`](https://github.com/asyncapi/spec) — `v2.6.0` `examples/gitter-streaming.yml` | Apache-2.0 |
| `v2.6/slack-rtm.yaml` | [`asyncapi/spec`](https://github.com/asyncapi/spec) — `v2.6.0` `examples/slack-rtm.yml` | Apache-2.0 |
| `v2.6/streetlights-kafka.yaml` | [`asyncapi/spec`](https://github.com/asyncapi/spec) — `v2.6.0` `examples/streetlights-kafka.yml` | Apache-2.0 |
| `v2.6/streetlights-mqtt.yaml` | [`asyncapi/spec`](https://github.com/asyncapi/spec) — `v2.6.0` `examples/streetlights-mqtt.yml` | Apache-2.0 |
| `v3.0/correlation-id.yaml` | [`asyncapi/spec`](https://github.com/asyncapi/spec) — `v3.0.0` `examples/correlation-id-asyncapi.yml` | Apache-2.0 |
| `v3.0/slack-rtm.yaml` | [`asyncapi/spec`](https://github.com/asyncapi/spec) — `v3.0.0` `examples/slack-rtm-asyncapi.yml` | Apache-2.0 |
| `v3.0/streetlights-kafka.yaml` | [`asyncapi/spec`](https://github.com/asyncapi/spec) — `v3.0.0` `examples/streetlights-kafka-asyncapi.yml` | Apache-2.0 |
| `v3.0/streetlights-mqtt.yaml` | [`asyncapi/spec`](https://github.com/asyncapi/spec) — `v3.0.0` `examples/streetlights-mqtt-asyncapi.yml` | Apache-2.0 |
| `v3.0/websocket-gemini.yaml` | [`asyncapi/spec`](https://github.com/asyncapi/spec) — `v3.0.0` `examples/websocket-gemini-asyncapi.yml` | Apache-2.0 |

To refresh a fixture, re-fetch it from its source URL and commit the result.
