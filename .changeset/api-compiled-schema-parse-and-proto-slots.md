---
'@amritk/api': patch
---

Close a compiled-engine validation bypass, and stop dropping `__proto__`-named headers and path parameters

**`compileToModule` baked its schema constants as object literals, which is not
a faithful copy of the JSON they were printed from.** A JavaScript object
literal treats `__proto__` as the prototype setter, so a contract declaring a
property under that name — perfectly ordinary in a schema loaded from a config
file, a database row, or an imported OpenAPI document, where the key really is
an own property — compiled to a constant with that property silently missing.
The compiled engine then validated a schema the runtime engine never had, and
diverged in both directions: it rejected `{"__proto__":"abc"}` under
`additionalProperties: false` that the runtime accepted, and accepted
`{"__proto__":123}` against `{"type":"string","minLength":3}` that the runtime
rejected. The second is a validation bypass in the production engine — the
declared constraint was simply gone.

Every constant baked from contract data — request schemas for all five slots,
response body and header schemas, and the interpreter's options — now emits as
`JSON.parse('…')`, where each key lands as an own property. The argument is a
correctly-escaped single-quoted string literal (backslashes, single quotes, and
U+2028/U+2029, which are legal unescaped in JSON but were line terminators in
pre-ES2019 JavaScript source), pinned by a round-trip test over hostile input.
There is no startup cost: a JSON string literal evaluates about 13% faster than
the equivalent object literal at module init on a 46 KB schema, and the emitted
module grows by 14 bytes per constant (0.6% on a realistic module). The
precomputed OpenAPI document was never affected — it was already a string
literal.

The differential corpus gained a route declaring `__proto__` as its path
parameter, header, cookie, *and* body property at once, so the two engines are
now pinned to agree on the correct answer for all of them, and the emitter has
an invariant test that no schema constant may be a bare object literal.

**Headers and path parameters named `__proto__` are no longer dropped.** The
same write-side bug the cookie parser had: `__proto__` is a valid HTTP field
name (it is a token) and a valid path-template capture name, but a plain
`record[name] = value` runs the prototype setter instead of creating the
property. A contract declaring one saw nothing, and `required: ['__proto__']`
could never be satisfied. Fixed in the route matcher, the params builder, and
the headers builder through a shared `defineOwnProperty`, which the cookie
parser now shares too; the compiled engine unrolls its own params and headers
builders, so it emits the equivalent `Object.defineProperty` for that one name
and pays nothing for every other.

Also: the schema-derived response serializer now declines any property whose
name shadows an `Object.prototype` member, falling back to `JSON.stringify` —
its `body["<key>"]` reader would otherwise answer with the inherited member
rather than `undefined` when the reply omits the property, so a `__proto__`
property serialized as `{}` and an optional `toString` was emitted on every
reply. This is the same bail the inline guard emitter already made, and the two
now share one list of risky names.
