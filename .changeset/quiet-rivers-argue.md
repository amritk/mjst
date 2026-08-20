---
'@amritk/generate-examples': minor
---

A round of fixes for generated files that did not compile, threw at import, or
hung when sampled. Measured against a real OpenAPI corpus, 13% of schemas
produced a file that failed to type-check before these.

**Files that did not compile**

- The validating filter's type guard (`(value): value is T`) requires the
  declared type to extend what the base expression infers, but a filtered
  arbitrary deliberately builds a *different* shape — `contains` generates
  `number[]` for a declared `unknown[]`, `dependentRequired` promotes an optional
  key to required, `dependentSchemas` adds one the type never declared. Each
  raised TS2677. The base is now widened to `Arbitrary<unknown>` first.
- A schema with `properties` and no `type: object` — ordinary in OpenAPI — got a
  type of `{ … }` but an arbitrary of `fc.anything()` and an example of `null`.
  Both now infer the object shape the same way the type generator does.
- A recursive definition's example cuts the cycle with `null`, which its
  non-nullable type rejects. It is now emitted with an assertion.
- `contains` alongside `items` put a `contains`-typed value into an
  `items`-typed array. `items` constrains every element, so a `contains` value is
  used only when `items` accepts it too.
- A non-finite `multipleOf` derived `NaN`, which serialized as `null`.
- A non-string `required` entry reached the emitted `requiredKeys`.

**Modules that threw at import, or hung when sampled**

- An uncompilable `pattern` (`"["`) or one using a lookahead/lookbehind made
  `fc.stringMatching` throw — at import for the first, at sample time for the
  second — taking every export in the file with it. Both now fall back to
  `fc.string()`. The embedded runtime validator is likewise only emitted when it
  can actually be built.
- An integer bound beyond fast-check's 32-bit range left it with a minimum above
  its own maximum, and threw. Bounds are now confined to that range.
- `uniqueItems` over a closed value set (`items: { type: 'boolean' }`,
  `minItems: 5`) asked for more distinct values than exist, and fast-check
  retries forever. The length is now capped at the size of the set.

**Crashes and resource use**

- A property named `__proto__` under any `allOf` threw
  `TypeError: bucket.push is not a function` out of the whole generation run:
  `mergeAllOf` read its accumulator with a bare index, which answers
  `Object.prototype` for that key. Its accumulators are now null-prototype.
- A deeply nested document died with a bare `RangeError` from whichever helper
  was deepest. The three recursions here now refuse past 400 levels with a
  message naming the limit.
