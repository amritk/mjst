---
'@amritk/lint': patch
---

Index `$ref` targets once instead of rescanning per component, and cap filter nesting.

- `unreferencedReusableObject` and `oasUnusedComponent` each rescanned the whole
  `$ref` set for every component — and the former copied that set into a fresh
  array on each one. Both now share one index of every ref and its ancestors: on
  a document with 5,000 refs and 3,000 components the check drops from ~810 ms to
  ~10 ms, and the duplicated ref walk is gone.
- `or`, `xor`, and `typedEnum` read through the prototype chain. A rule listing
  `constructor` counted it as present on every object, and a schema written
  `type: valueOf` produced a bogus error-severity "rule threw" finding.
- A deeply nested `[?(...)]` filter failed with "Maximum call stack size exceeded
  at offset undefined", at a threshold that varies by runtime. Filters now refuse
  to nest past 100 levels with a message that says so, and an error no longer
  echoes an unbounded expression body.
