---
'@amritk/generate-validators': patch
'@amritk/api': minor
---

Let `@amritk/api` assert string formats, and document where `format` is ignored

`format` is an annotation in JSON Schema, and both Ajv and
`@amritk/runtime-validators` make asserting it opt-in. `@amritk/api` never opted
in and offered no way to, so a route declaring
`{ type: 'string', format: 'uuid' }` accepted any string — while the README said
the format "still applies". Short of replacing the whole engine through
`compile`, there was no way to get the check.

Both engines now take `formats`, matching the interpreter's own option:

```ts
createApi({ routes, formats: 'all' })
createApi({ routes, formats: ['uuid', 'email'] })
compileToModule({ routes, routesImport, formats: 'all' })
```

A violation is an ordinary `400 { error: 'validation_failed' }`. Pass the same
value to both engines so the compiled module and the development server agree;
the option is ignored when a custom `compile` is supplied, since that replaces
the engine it configures. Default behavior is unchanged — `format` stays an
annotation until you ask.

In the compiled engine a schema carrying `format` leaves the inlinable subset
and falls back to the interpreter, which owns the format regexes, rather than
the emitter growing a second copy of each. Engine-for-engine equivalence is
covered by a new differential case.

`@amritk/generate-validators` emits no `format` check either, and that was
nowhere in its docs — a real divergence from the interpreter as `@amritk/lint`
runs it (`formats: 'all'`). Now stated in the README, AI.md, and AGENTS.md, with
a test pinning it, and the benchmark section no longer claims every library does
the same work on the two rows whose schemas declare `format`.
