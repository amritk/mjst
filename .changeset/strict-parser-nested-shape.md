---
'@amritk/generate-parsers': patch
---

Close six holes where a *strict* parser accepted a document its schema rejects,
or altered a document it accepted. Each was reduced from a differential fuzz run
against Ajv, and each is now covered by a test asserted against Ajv rather than
against a hand-written verdict.

A nested object property's own `properties` and `required` were enforced only by
the private sub-parser the parent synthesizes for it — and that sub-parser is
emitted only for a plain inline object, and only by the object parser. A sibling
keyword (`allOf`, `not`, `if`, `patternProperties`, a schema-valued
`additionalProperties`, a union) took the property out of that set, and the
pattern-property parsers never emit sub-parsers at all, so
`{ c: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'],
additionalProperties: { type: 'string' } } }` accepted `{ c: {} }` and
`{ c: { a: 'no' } }` alike. The assertions now prove such a property's shape
themselves.

The fast-path guard reported "already in shape" for values the schema rejects:
an object property carrying `required` was proven with a bare `isObject`, and a
union property's guard was the branch disjunction alone, with the node's own
`type` / `required` / `properties` left out. Both now decline, so the value takes
the slow path where the real assertions run.

`additionalProperties: false` stopped rejecting undeclared keys as soon as the
schema also carried `allOf` / `oneOf` / `anyOf`. 2020-12 answers that keyword
against the schema object's own `properties`, so composition has no say in it.

A scalar `items` schema was checked with a bare `typeof`, dropping its
constraints: `{ items: { type: 'string', minLength: 1 } }` accepted `[""]`.

A union branch spelled `{ type: ['string', 'null'] }`, or `{ type: 'null' }`,
produced no check at all — so it matched nothing, and a valid `null` was coerced
away rather than kept.

An optional property whose schema was an `allOf`, a `not`, or had no `type` fell
back to the schema's default when the key was *absent*, conjuring a property the
input never had into the parser's result.
