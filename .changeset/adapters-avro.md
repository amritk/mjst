---
'@amritk/adapters': minor
'@amritk/mjst': minor
---

Add an Apache Avro adapter at `@amritk/adapters/avro-to-json-schema`, wired into
the CLI as `--input avro`.

Avro is the schema language most event-driven APIs actually use, and it is the
one format here with no JSON Schema exporter to delegate to — so the conversion
is implemented in full. It still adds **no dependency**: an `.avsc` is already
JSON, so there is nothing to parse that `JSON.parse` does not.

```ts
import { avroToJsonSchema } from '@amritk/adapters/avro-to-json-schema'

const jsonSchema = avroToJsonSchema(JSON.parse(avsc))
```

```sh
mjst --schema user.avsc --input avro --out-dir ./generated
```

Every named type (`record`, `enum`, `fixed`) is defined once under its
**fullname** in `$defs` and referenced by `$ref` everywhere it appears, so a
recursive type stays finite and `com.example.User` generates a `ComExampleUser`
type rather than an inline shape repeated at each use site. Unlike the other
formats, `--schema` points at the JSON document itself rather than a JS/TS
module — nothing is imported, so `--export` does not apply.

**Pick the encoding you mean.** Avro is a binary format with a *separately
specified* JSON encoding, and the two readings of "the JSON for this schema"
genuinely disagree, so the adapter makes you choose:

| `encoding` | Describes | Unions | `bytes` | Fields with a `default` |
|:---|:---|:---|:---|:---|
| `'json'` *(default)* | the object your application code sees | plain `anyOf`; `["null", T]` collapses to a nullable `T` | base64 | optional |
| `'avro-json'` | the spec's JSON encoding, as sent under `application/vnd.apache.avro+json` | single-key wrappers tagged with the branch's fullname | codepoint-per-byte string | required |

The `default` column is not a style choice. Avro has **no optional fields** —
every declared field is present in the encoding, and a `default` is only
consulted during schema resolution, when reading data written against a
*different* schema. So `'avro-json'` marks every field required, because that is
what is on the wire, while `'json'` treats a defaulted field as optional,
because that is the shape application code deals with. For the same reason a
latin-1 byte `default` is dropped under `'json'` rather than mistranslated:
`default` is not annotation-only here, since `@amritk/generate-parsers` coerces
with it.

Two mappings look like gaps and are deliberate:

- **A `long` gets no bounds.** Its range is ±2^63, which no JSON number can
  represent — a stated `maximum` would round to 2^63 and be both wrong and
  unreachable. An `int` *is* bounded, since ±2^31 lands exactly on a double.
- **Date and time logical types stay integers.** Avro encodes
  `timestamp-millis` as a `long` in its JSON encoding as much as in binary, so
  `format: 'date-time'` would describe a string that never arrives. Only `uuid`
  narrows its base type.

The default **value** is translated, not copied: Avro states a union's default as
a bare value of its first branch, so under `'avro-json'` it is wrapped to match
the branch tagging the data uses (`null` stays bare), and under `'json'` a
latin-1 byte default is dropped rather than mistranslated into base64. Both rules
apply at any depth, and a byte value anywhere inside a default drops the whole
default — a half-translated one is worse than none.

`decimal` and `duration` degrade to their base type and are reported through the
existing widening warning (`strict: true` throws instead). An unrecognised
`logicalType` falls through to its base type silently, which the Avro spec
requires, as does one declared on a base it is not defined for. Names are
validated against the spec's pattern, since a name is written straight into a
`$defs` key and the `$ref` pointing at it. `aliases` and field `order` describe how *two* schemas relate during
resolution and have no place in a single document's shape, so they are ignored.
A duplicate name, a reference to an undefined name, or a malformed
`record`/`enum`/`fixed` throws rather than converting to something wrong.
