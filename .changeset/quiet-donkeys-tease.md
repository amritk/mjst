---
'@amritk/lint': minor
---

Add the six AsyncAPI 3.x rules that only existed for 2.x.

`asyncapi-3-payload`, `asyncapi-3-payload-default`, `asyncapi-3-payload-examples`,
`asyncapi-3-message-examples`, `asyncapi-3-schema-default` and
`asyncapi-3-schema-examples` mirror their 2.x twins (error, recommended,
resolved). Until now the same authoring mistake — a payload that is not a valid
Schema Object, an example or `default` that contradicts its schema — was an
error in a 2.6 document and completely silent in a 3.0 one.

Each understands 3.0's Multi Format Schema Object, so a payload reports the same
finding whether it is written bare or wrapped, and reports at the wrapper's
`schema` when wrapped. An Avro payload still reports only
`asyncapi-3-payload-unsupported-schemaFormat`, never these. 3.0 Channel
Parameter Objects deliberately get no rule: unlike 2.x they carry no `schema`.

The ruleset goes from 56 rules to 62, and from 48 recommended to 54.
