<div align="center">

# @amritk/runtime-validators

**Extremely fast runtime JSON Schema validation — for schemas you do not know ahead of time.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/npm/v/@amritk/runtime-validators?style=flat-square&logo=npm&logoColor=white&label=version&color=6366f1)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

</div>

---

## Overview

[`@amritk/generate-validators`](../generate-validators) writes validator **source files** at build time from a schema you already have. This package is its runtime sibling: it validates against a schema **you only discover at runtime** — a plugin config, a user-supplied schema, an OpenAPI fragment.

It is an **eval-free interpreter**: it walks the schema directly, with **no `new Function`, no code generation, and no build step**. That buys two things. First, **zero startup cost** — there is nothing to compile, so building a validator is essentially free and you only pay to walk the data you actually validate. Second, it **runs anywhere** — under a strict `Content-Security-Policy` (no `unsafe-eval`), on Cloudflare Workers, in React Native/Hermes, and in any sandbox that forbids `eval`/`new Function`, all of which rule out a code-generating validator.

The trade is steady-state throughput: a JIT-compiled validator (like Ajv after it compiles) validates a *single fixed schema* against *millions of values* faster than an interpreter can. So this package is tuned for the opposite shape — **validate a few values per schema, in a cold process** (CLI checks, one-shot config validation, edge requests), where there is no compile cost to amortize. See [Performance](#performance).

Three entry points, for three different jobs:

- **`validateGuard(schema)`** → `(input) => input is T`. A boolean type guard that short-circuits on the first failure and never builds an error object. Reach for this when you only need yes/no.
- **`validate(schema)`** → `(input) => true | { valid: false, errors }`. Collects every error with a JSON Pointer path, so you can tell a caller exactly what went wrong.
- **`assert(schema, value)`** → `T`. The one-shot "valid or bust" path: returns the value typed to the schema, or throws a `ValidationFailedError` (carrying the same `errors` array) when it does not match. Reach for this when invalid input is exceptional and you want a parse step, not a result to branch on.

---

## Installation

```bash
npm install @amritk/runtime-validators
# or
pnpm add @amritk/runtime-validators
# or
yarn add @amritk/runtime-validators
# or
bun add @amritk/runtime-validators
```

---

## Usage

```ts
import { assert, validate, validateGuard } from '@amritk/runtime-validators'

const schema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    name: { type: 'string', minLength: 1 },
    tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  },
  required: ['id', 'name'],
  additionalProperties: false,
} as const

// Detailed errors
const validator = validate(schema)
const result = validator({ id: 1, name: 'Ada', tags: ['a', 'b'] })
if (result !== true) {
  console.error(result.errors) // [{ message, path }, ...]
}

// Fast boolean guard — the guarded type is inferred from the schema
const isUser = validateGuard(schema)

if (isUser(input)) {
  input.name // narrowed to { id: number; name: string; tags?: string[] }
}

// Valid or bust — one call, returns the typed value or throws a ValidationFailedError
const user = assert(schema, { id: 1, name: 'Ada' })
//    ^? { id: number; name: string; tags?: string[] }
```

### Type inference

Write the schema `as const` and the output type comes along for free — no
hand-written interface to drift from the schema. `validate` and `validateGuard`
infer it directly; `Infer` recovers it from a built validator, and `FromSchema`
derives it from a schema type:

```ts
import { validate, type FromSchema, type Infer } from '@amritk/runtime-validators'

// Straight from the schema type…
type User = FromSchema<typeof schema>
//   ^? { id: number; name: string; tags?: string[] }

// …or from a built validator.
const validateUser = validate(schema)
type SameUser = Infer<typeof validateUser>
```

Runtime-only constraints (`minLength`, `pattern`, numeric bounds, …) leave the
base type untouched, so `name` stays `string`. Inference covers every keyword that
shapes a type — `type` (incl. unions, `integer`, `nullable`), `const`, `enum`,
`properties`/`required`/`additionalProperties`/`patternProperties`,
`items`/`prefixItems` (lists and tuples), and `allOf`/`anyOf`/`oneOf`. It also
honours the [`x-mjst` brand](../adapters/README.md#nominal-brands): a schema with
`'x-mjst': { brand: 'UserId' }` infers `Base & { readonly __brand: 'UserId' }`
(e.g. `string & …`), matching the code generators' `.d.ts` output. Branding is
type-level only — runtime validation still checks the plain base type — so it's
how `@amritk/api` gives route params/query/body nominal ids. Keywords
that cannot be expressed structurally (`$ref`, `not`, `if`/`then`/`else`,
`unevaluated*`) are skipped so the inferred type stays useful rather than
collapsing to `never`. You can still pass an explicit type argument
(`validateGuard<MyType>(schema)`) to override inference.

Recursive schemas via local `$ref` work out of the box:

```ts
const isTree = validateGuard({
  type: 'object',
  properties: {
    value: { type: 'number' },
    children: { type: 'array', items: { $ref: '#' } },
  },
  required: ['value'],
})
```

---

## Performance

Pick the right tool for the shape of your workload. There are two regimes, and they have opposite winners.

**Cold one-shot — schema to first result.** This is the path this package is built for: you have a schema and a value or two, in a fresh process, and you want an answer. There is no compile step, so the cost is essentially one walk of the data. Ajv must compile the schema (build and JIT a function) before it can validate even once. Representative numbers from `bun run bench` (your hardware will differ — run it yourself):

| schema | `validate` (cold) | Ajv (compile + run) | speedup |
|:---|---:|---:|---:|
| small | ~0.009 ms | ~10 ms | **~1100×** |
| wide (40 props) | ~0.016 ms | ~14 ms | **~870×** |
| deep (`$ref`) | ~0.12 ms | ~13 ms | **~110×** |

**Steady state — one schema, many values.** Here Ajv wins, and it is not close: once compiled, its JIT'd function outruns a tree-walking interpreter by roughly **6–10×** per call. If you validate the same schema against a high-throughput stream, compile it once with Ajv (or use this repo's build-time [`@amritk/generate-validators`](../generate-validators)) — an interpreter is the wrong tool for that job, and this package does not pretend otherwise.

So the rule of thumb: **few values per schema → interpret** (no compile cost to amortize, and it runs eval-free anywhere); **many values per schema → compile**.

What keeps the interpreter lean:

- **No compile step.** `validate` / `validateGuard` return immediately — there is nothing to build, JIT, or warm up.
- **Lazy, reused caches.** The only reusable work — compiling `pattern` regexes and resolving `$ref` targets — is memoized the first time it is hit and reused on later calls.
- **Nothing built for errors that never happen.** The error array and every failure message are created only when a failure is actually recorded and will actually be read, so valid input — and the whole guard path — never builds one. That is not the same as zero allocation: a branch probe (`anyOf`, `oneOf`, `not`, `if`, `contains`, `propertyNames`) allocates a small context, `unevaluatedProperties`/`unevaluatedItems` allocate an annotation tracker, and `uniqueItems` builds a `Set`. Everything genuinely reusable — property keys, the `required` set, compiled `patternProperties`, dependency entry lists — is memoized per schema node instead of rebuilt per call.
- **A `WeakMap` cache** keyed by schema object, so `validate(sameSchema)` hands back the same validator (with its warm caches) per `(mode, formats)`.

> Benchmarks live in [`bench/`](./bench) and run a correctness parity check against Ajv on every case. Correctness is further locked down by [`src/differential.test.ts`](./src/differential.test.ts), a differential fuzz that compares the interpreter's verdict against Ajv's across ~240k random and mutated values (20 schema shapes × 12k values, zero divergences) — so "fast" never comes at the cost of "correct".

---

## API

### `validate(schema, options?)`

Builds an error-collecting validator that interprets the schema on the fly.

| Parameter | Type | Description |
|:---|:---|:---|
| `schema` | `unknown` | A JSON Schema (object, or a boolean schema). Same-document `$ref`s resolve — pointers, `$anchor`s, and refs written against an `$id` as a base URI — including recursion. |
| `options.schemas` | `Record<string, unknown>` | Documents you have already loaded, keyed by the absolute URI a `$ref` names them by — see [Referencing other documents](#referencing-other-documents). |
| `options.formats` | `'all' \| string[]` | String formats to enforce. Unlisted formats are treated as annotations (not validated), matching Ajv's opt-in behavior. |
| `options.limits` | `ValidateLimits` | Per-validation resource ceilings — see [Resource limits](#resource-limits). |

Returns a `Validator`: `(input: unknown) => true | { valid: false; errors: ValidationError[] }`. When the schema is written `as const`, the validator carries the inferred output type — recover it with `Infer`.

### `validateGuard<T>(schema, options?)`

Builds a boolean type guard `(input: unknown) => input is T`. Same options as `validate`; it short-circuits on the first failure and never builds an error object or message, so it is the faster of the two when you only need yes/no. `T` is inferred from a schema written `as const`; pass it explicitly to override.

### `assert(schema, value, options?)`

Validates `value` against the schema in a single call and returns it typed to the schema, or throws a `ValidationFailedError` when it does not match — a plain `Error` (so `instanceof Error` and logging work) whose message lists each failure and whose `errors` property carries the same `ValidationError[]` that `validate` collects. Same `options` as `validate`. Reach for it when invalid input is exceptional and you would rather parse-or-throw than branch on a result. When the schema is written `as const` (or inferred via the `const` parameter), the return type is inferred from it.

### Resource limits

The interpreter walks arbitrary — and possibly untrusted — schemas over
arbitrary data, so three unbounded costs carry a ceiling. Every default is
generous enough that ordinary schemas and documents never approach it, and each
is tunable per call via `options.limits`:

| Limit | Default | Guards against |
|:---|---:|:---|
| `maxDepth` | `512` | Deeply-nested data against a recursive schema (`{ items: { $ref: '#' } }`) overflowing the native stack as an uncatchable `RangeError`. |
| `maxSteps` | `10_000_000` | Exponential combinator blow-up (nested `anyOf`/`oneOf` re-evaluating every branch) and quadratic `uniqueItems`. |
| `allowUnsafePatterns` | `false` | ReDoS: a `pattern` prone to catastrophic backtracking is screened out before a validator is built. Set `true` only when every schema is trusted. |

> **The ReDoS screen is a filter, not a guarantee.** It rejects two recognizable
> shapes — nested unbounded quantifiers (`(a+)+$`) and a provably ambiguous
> alternation under an unbounded quantifier (`(a|a)+$`) — across every `pattern`
> and `patternProperties` key anywhere in the document. Deciding whether an
> arbitrary regex backtracks catastrophically means deciding language ambiguity,
> which no cheap syntactic pass can do, so patterns that are genuinely
> exponential still get through (`(a|aa)+`, `a*a*$`). Treat it as defence in
> depth behind `maxSteps` and a request timeout, not as a reason to trust an
> arbitrary third-party `pattern`. The screen can also over-reach in the other
> direction and flag a benign pattern; `allowUnsafePatterns: true` is the escape
> hatch when you have reviewed it yourself.

Exceeding a runtime ceiling **throws** rather than silently returning a verdict —
the same fail-loud contract as an unresolvable `$ref` or an unknown `type`. The
thrown value is a plain `Error` with a recognizable `name`; use
`isValidationLimitError(error)` to tell it apart from an ordinary throw.

```ts
import { isValidationLimitError, validate } from '@amritk/runtime-validators'

const isValid = validate(untrustedSchema, { limits: { maxSteps: 100_000 } })
try {
  isValid(payload)
} catch (error) {
  if (isValidationLimitError(error)) return reject('schema too expensive')
  throw error
}
```

### `FromSchema<Schema>` and `Infer<Validator>`

Type-level helpers. `FromSchema<typeof schema>` infers the type a schema (written `as const`) accepts; `Infer<typeof validator>` recovers that type from a built `validate`/`validateGuard`. See [Type inference](#type-inference) above.

### Supported keywords

`type` (incl. unions and `integer`), `enum`, `const`, `properties`, `required`, `additionalProperties`, `patternProperties`, `propertyNames`, `minProperties`, `maxProperties`, `dependentRequired`, `dependentSchemas`, `dependencies` (draft-07), `items`/`prefixItems` (2020-12) and array-`items` + `additionalItems` (draft-07), `contains`/`minContains`/`maxContains`, `minItems`, `maxItems`, `uniqueItems`, `unevaluatedProperties`, `unevaluatedItems`, `minLength`, `maxLength`, `pattern`, `format` (opt-in), `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum` (both the numeric 2020-12 form and the draft-04 boolean modifier), `multipleOf`, `allOf`, `anyOf`, `oneOf`, `not`, `if`/`then`/`else`, `$ref` (same-document, including `$id` base-URI scoping), `$dynamicRef`/`$dynamicAnchor` (2020-12, resolved through the dynamic scope), `$recursiveRef`/`$recursiveAnchor` (2019-09, bound document-globally), `nullable` (OpenAPI 3.0), boolean schemas.

> **Unknown `type` values throw.** A `type` outside the seven JSON Schema names (`type: "strng"`) is a schema error, not a data error — the validator throws when the keyword is consulted rather than silently matching everything, the same loud contract as an unresolvable `$ref`.

> The interpreter never fetches anything, but it is not limited to one document. Same-document `$ref`s resolve on their own — JSON-Pointer fragments (`#/$defs/user`), `$anchor` names (`#user`), and refs written against an `$id` as a base URI (relative, absolute, or a URN), including recursion. For a `$ref` into *another* document you have two options: hand the document over with `options.schemas`, or bundle everything into one with [`@amritk/resolve-refs`](../resolve-refs) first. See [Referencing other documents](#referencing-other-documents).

> **Built-in `format`s** (opt-in via `options.formats`): `email`, `idn-email`, `date-time`, `date`, `time`, `duration`, `uuid`, `uri`, `iri`, `uri-reference`, `iri-reference`, `uri-template`, `json-pointer`, `relative-json-pointer`, `hostname`, `idn-hostname`, `ipv4`, `ipv6`, `regex` (compiled, not pattern-matched). Unlisted or disabled formats are treated as annotations, matching Ajv's default opt-in behavior.

> **OpenAPI `nullable`.** When a subschema sets `nullable: true`, a `null` value is accepted regardless of its declared `type` (and short-circuits every other keyword), matching how Ajv is configured to treat OpenAPI 3.0 schemas. Without this, a single nullable field produced a flood of spurious `must be …` errors.

### Not supported (by design)

This is a **pragmatic subset** of JSON Schema — sized for validating data against the kind of schemas real APIs and configs use, not for being an authoritative, spec-complete validator. The following are intentionally left out; if your schemas lean on them, reach for Ajv:

- **Fetching.** No `fetch`, no filesystem, no cache — that is what keeps `validate` synchronous and safe to run under a strict CSP. It is not a limit on *which* documents can be referenced, only on who loads them: pass what you have to `options.schemas` and refs into it resolve like any other, or bundle first with [`@amritk/resolve-refs`](../resolve-refs), which owns the network and its policy. A URI you did not supply throws, naming it. See [Referencing other documents](#referencing-other-documents).
- **`contentEncoding` / `contentMediaType` / `contentSchema`** — treated as annotations (ignored), as they are by default in 2020-12.
- **Spec-exact `format` coverage.** Formats are opt-in and validated by pragmatic regexes that reject obviously-bad input rather than being RFC-perfect. (The `regex` format is the exception — it compiles the string to confirm it is a valid pattern.)
- **Draft-2020 exotica** beyond the keywords listed above.

> **Want one of these?** None of these are off the table — "by design" means *not yet*, not *never*. If something here is blocking a real use case, [open an issue](https://github.com/amritk/mjst/issues) describing the schema you need to validate.

### Conformance, measured

The subset above is not a claim — it is checked. `src/conformance.test.ts` runs
the official [JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite)
(the required Draft 2020-12 tests — 1299 cases) through *both* entry points on
every build, since `validate` and `validateGuard` share the interpreter but not
the path through it:

**1299 / 1299 cases pass — the whole suite.**

`src/conformance-expected-failures.test-utils.ts` is empty, and stays in place
empty: the test fails if any case starts failing, so the build names the first
regression instead of letting a percentage tick down. The corpus is vendored under
[`fixtures/json-schema-test-suite`](../../fixtures/json-schema-test-suite) and
never imported by `src/index.ts`, so none of it reaches the published bundle.

The cases that reference other documents — all of `refRemote.json`, the
`dynamicRef` groups reaching for `tree.json`, the refs at the dialect metaschema —
run with those documents supplied through `options.schemas`, which is the
sanctioned equivalent of the HTTP server the suite would otherwise expect: same
documents, same URIs, handed over instead of fetched. The interpreter still does
every bit of the base-URI, anchor and cross-document `$dynamicRef` work those cases
exist to test; only the retrieval step is answered for it, and that is the one
thing this package will never do itself.

> **`unevaluatedProperties` / `unevaluatedItems` note.** These are supported and collect annotations across the in-place applicators applied to the *same* schema object — `allOf`, `$ref`/`$dynamicRef`, the taken `if`/`then`/`else` branch, successful `anyOf`/`oneOf` branches, and `dependentSchemas`. The one case not covered is an `unevaluated*` keyword nested *inside* one applicator branch reading annotations produced by a *sibling* branch of an ancestor (e.g. `unevaluatedProperties` inside `allOf[1]` expecting to see keys evaluated by `allOf[0]`); keep `unevaluated*` at the same level as the keywords it should account for.

---

## Referencing other documents

The interpreter never fetches. That is deliberate: `validate` returns a
**synchronous**, I/O-free function so it can run on the hot path and inside strict
sandboxes (CSP, Cloudflare Workers, React Native/Hermes), and a `$ref` pointing at
`http://169.254.169.254/…` or `file:///etc/passwd` would otherwise turn a validator
into an SSRF gadget.

Not fetching does not mean not knowing. **Hand over the documents you already
have** and refs into them resolve like any other — each is a full schema resource,
so its own `$id`, `$anchor`s, `$dynamicAnchor`s and embedded resources all
register, and `$dynamicRef` bookending works across documents:

```typescript
import { validate } from '@amritk/runtime-validators'

const isValid = validate(schema, {
  schemas: {
    'https://example.com/address.json': addressSchema,
    'https://example.com/user.json': userSchema,
  },
})
```

Pass the registry as an immutable value. The prepared-validator cache keys on its
identity *and* its URI set, so adding or removing a document is a cache miss rather
than a stale hit; swapping the contents under a URI in place is undetectable,
exactly as mutating the schema object is.

That includes the dialect itself, which is how you validate a schema *as* a schema
— and what lets `$vocabulary` be read, so a custom metaschema that omits the
validation vocabulary turns those keywords into annotations:

```typescript
import { metaschema } from '@amritk/runtime-validators/metaschema'

validate(userSuppliedSchema, { schemas: metaschema }) // is this valid 2020-12?
```

The eight specification documents are ~7.9 KB and live behind that subpath, so a
caller who never asks for them ships none of it.

**The alternative is to bundle first**, which is the right answer when the
documents live on disk or behind a URL:
[`@amritk/resolve-refs`](../resolve-refs) is the async, I/O-aware half — it caches
documents, coalesces concurrent loads, and applies a default-deny SSRF guard
(loopback, private, link-local and cloud-metadata hosts refused unless
allow-listed, re-applied on every redirect hop):

```typescript
import { resolveRefsFromFile } from '@amritk/resolve-refs'
import { validate } from '@amritk/runtime-validators'

// Async: fetches/reads and inlines every external $ref, SSRF-guarded.
const { resolved: schema } = await resolveRefsFromFile('./openapi.schema.json')

// Sync, pure, slim — every $ref is now local.
const isValid = validate(schema)
isValid(value)
```

Either way the split holds: `resolve-refs` owns the network and its policy,
`runtime-validators` stays a pure function of its inputs.

---

## Related packages

- [`@amritk/resolve-refs`](../resolve-refs) — inline cross-file and remote `$ref`s before validating
- [`@amritk/generate-validators`](../generate-validators) — generate validator source files at build time
- [`@amritk/generate-parsers`](../generate-parsers) — type definitions plus parsers that coerce input
- [`@amritk/mjst`](../cli) — CLI wrapper around the generators

---

## License

[MIT](../../LICENSE)
