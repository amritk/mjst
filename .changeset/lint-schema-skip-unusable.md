---
'@amritk/lint': minor
---

Add a `skipUnusableSchema` option to the built-in `schema` function.

When the runtime validator cannot build or run a schema — most often a `$ref` it
cannot resolve, which only surfaces when the validator runs — `schema` reports
why. That is right for a schema written in the *ruleset*: if that one is
unusable, its author wants to hear about it.

It is wrong for a schema taken from the *document*. A message payload or a
parameter's schema can legitimately carry a reference this package cannot
follow: an external file, or anything at all when no `$ref` resolver was
injected. There the validator's complaint is not a finding about the document —
it is an error-severity diagnostic, on a valid document, whose text describes
this package's own API and tells the reader to pass `{ schemas: … }`.

Callers validating a document-supplied schema pass `skipUnusableSchema: true`
and get silence where they cannot judge. The default is unchanged, so no
existing ruleset behaves differently. The OpenAPI preset's example rules already
did this with their own validator wrapper; the AsyncAPI payload, example and
default rules now do it through this option.
