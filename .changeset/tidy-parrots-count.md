---
---

Add a head-to-head benchmark for the two code paths that turn unknown input into
a typed value: `@amritk/generate-parsers` in coercing mode against
`@amritk/generate-validators --coerce`. Run it with `bun run bench:coerce` from
`packages/generate-validators` (or `bench:coerce:node` for the V8 numbers).

Unpublished dev tooling, so nothing ships — but the question it answers is not a
tooling question. The two generators look like one package wearing two names, and
whether they are turns on what they actually do differently. The bench reports
three things per case: whether both land on the same document when coercion can
succeed, what each costs at steady state across three input classes (nothing to
coerce, every scalar arrived as a string, and a document no coercion can fix),
and what each costs cold in codegen time and emitted bytes — split into the
per-schema file and the runtime an output directory pays for once, because a
single total badly misreads a fixed 17 KiB `validation-result.ts`.

Schemas are single-sourced from the validators bench's own cases, and the
coercible sample is derived from the valid one by rewriting every number and
boolean as a string. That is what makes the agreement check worth asserting: the
expected output is the document the input was built from, not a second literal
that could drift.
