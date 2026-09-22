---
'@amritk/helpers': patch
'@amritk/validation': patch
---

Take the first `examples` entry that is an instance of the declared type, rather
than the first one outright.

`getDefaultValue` is the single table both engines repair toward, and its
`default` branch has long been guarded: a `default` left over from an earlier
shape is ignored unless it matches the type the schema declares, because
honouring one repairs a missing value into something the schema itself rejects.
The `examples` branch had no such guard, and examples are the likelier source of
the problem — they are illustrative rather than load-bearing, so they drift out
of step with the schema they document, and OpenAPI descriptions are full of them.

The visible failure is a generated file that does not compile. `examples` does
not drive the emitted type, so `{ type: 'integer', examples: ['abc'] }` still
emits `n: number` while the fallback literal becomes `"abc"`, and the parser
returns that literal uncast on its non-object path:

```
doc.ts: Type 'string' is not assignable to type 'number'. (TS2322)
```

The repairing validator does not fail to compile — it inlines the same literal in
a position typed loosely enough to accept it — but it returns `valid: false` with
the mistyped value in hand, declining a repair that the type-based fallback would
have completed.

A list is now scanned for the first usable entry instead of being abandoned at a
bad first one, so `examples: ['abc', 7]` repairs to `7`.

`const` and `enum` are deliberately left unguarded. They *drive* the emitted type
— `{ type: 'integer', const: 'abc' }` emits `'abc'`, not `number` — so their value
agrees with the type by construction, and falling through to a type-based
fallback would create the mismatch rather than avoid it.

Pinned by the parser suite's type-check pass, which compiles the emitted files
under the repo's own strict flags and fails on the `TS2322` without the fix.
