---
'@amritk/generate-parsers': minor
'@amritk/mjst': patch
---

Generated parsers now validate inline nested objects and respect
`additionalProperties: false`, matching the runtime interpreter and the
just-fixed validator generator:

- **Inline nested objects get a private sub-parser.** An object schema written
  directly under `properties` (rather than `$ref`'d) previously only passed an
  `isObject` check — its fields were never parsed, in either mode. Each inline
  nested object now gets a non-exported sub-parser, shape predicate, and type
  alias (`type OrderShipTo = Order["shipTo"]`) in the same generated file, and
  parsing recurses to any depth: coerce mode coerces nested fields (and builds
  deep defaults for non-object input), strict mode throws path-aware errors
  like `[OrderShipTo] field "zip" expected string, got number`.
- **`additionalProperties: false` is enforced.** Strict mode throws
  `[TypeName] unknown property "key"`; coerce mode strips undeclared keys from
  the result instead of spreading them through (previously extras — including
  a potential `__proto__` — flowed straight into the typed output). The shape
  predicate and the parser fast path refuse inputs with undeclared keys so
  extras cannot survive via `{ ...input }`. The declared-keys Set is hoisted
  to module scope and the sweep is an allocation-free `for...in` loop.

Schemas without `additionalProperties: false` generate byte-identical output
to before, so loose parsing keeps its existing fast path. Schemas combining
`additionalProperties: false` with composition keywords (`allOf`/`anyOf`/
`oneOf`) skip the undeclared-key handling, since the generator cannot evaluate
those yet. The `strict` option docs and config schemas no longer claim unknown
keys are always allowed.
