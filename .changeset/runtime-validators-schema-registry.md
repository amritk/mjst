---
'@amritk/runtime-validators': minor
---

Take documents the caller already has: `validate(schema, { schemas })`

The interpreter does no I/O — no `fetch`, no filesystem — which is what lets it
run under a strict CSP and on Workers. Until now that also meant it could not be
*told* about a document it did not receive, so a `$ref` naming another schema
threw and the answer was always "bundle it first".

`ValidateOptions.schemas` closes that without giving up anything: a plain record
of absolute URI → document, for schemas the caller has already loaded. A
registered document is a full schema resource — walked under its retrieval URI, so
its `$id`, `$anchor`s, `$dynamicAnchor`s and nested embedded resources all
register, a document with no `$id` resolves relative refs against the URI it was
registered under, and one whose `$id` disagrees answers to both. Cross-document
`$dynamicRef` bookending works. A URI that was *not* registered still throws, now
with a message showing how to supply it.

It is a record rather than an `addSchema` call on purpose: `addSchema` implies
mutable global state, and this package stays a pure function of its inputs. Pass
the registry as an immutable value — the prepared-validator cache keys on its
identity *and* its URI set, so adding or removing a document is a cache miss
rather than a stale hit (swapping the contents under a URI in place is
undetectable, exactly as mutating the schema object is, and is documented as
such).

With the metaschema registered, `$vocabulary` can finally be read: a custom
dialect that omits the validation vocabulary turns `minimum` and friends into
annotations instead of assertions. Two limits, both documented: it is read from
the root `$schema` rather than per schema resource, and it defaults to enforcing
whenever the metaschema was not registered, which is the stricter answer.

Nothing changes for callers who pass no registry: the key work is skipped, the
registry build stays gated on the document declaring an `$id`, and the vocabulary
check short-circuits.

**The package now passes the official JSON Schema Test Suite in full — 1299 / 1299
required Draft 2020-12 cases.** The harness hands the suite's own `remotes/`
documents to `schemas`, which is the sanctioned equivalent of the HTTP server the
suite would otherwise expect: same documents, same URIs, handed over instead of
fetched, with the interpreter still doing all the base-URI, anchor and
cross-document work the cases exist to test.

The dialect itself ships alongside, as an opt-in subpath:

```ts
import { metaschema } from '@amritk/runtime-validators/metaschema'

validate(userSchema, { schemas: metaschema }) // "is this a valid 2020-12 schema?"
```

Eight documents (the dialect plus its seven vocabulary metaschemas), ~7.9 KB of
JSON, reachable only through that subpath — the main entry never imports it, so a
caller who does not ask for it ships none of it. A test holds the copy to Ajv's
vendored specification text by deep equality, which makes Ajv a *check* on the
transcription rather than a runtime dependency of it.
