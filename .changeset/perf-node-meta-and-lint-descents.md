---
'@amritk/runtime-validators': patch
'@amritk/helpers': patch
'@amritk/lint': patch
---

Read each schema node's keywords once, compile lint filters, and match descents by key.

- **`@amritk/runtime-validators`** — the interpreter walked the schema afresh for
  every value and asked each node for every keyword it might carry on every one of
  those walks: about two dozen `Object.hasOwn` plus dynamic-key reads per node, per
  validation. A CPU profile of the steady-state benchmark put 31% of the whole run
  inside that one reader. A node's keywords are now read once into a fixed-shape
  record and reused, which makes each read a fixed-offset field load instead of a
  megamorphic dictionary lookup, moves the `typeof` narrowing off the hot path, and
  lets group flags skip the reference, branching and type-specific blocks outright.
  Steady-state throughput is 2.1–3.6× on the benchmark cases. Building the record
  walks the node's own keys — three or four, rather than two dozen questions — so it
  is cheaper than a single old scan, and the cache only starts filling on a
  validator's *second* call, leaving the cold one-shot path unchanged-to-better.
  `@amritk/api`'s runtime engine and `@amritk/lint`'s `schema` rule both run this
  interpreter, so both inherit it.
- **`@amritk/helpers`** — `generateIndexBarrel` read every character of every
  generated file looking for `export` at a line start, which was ~18% of a
  generation run. It now jumps between `export ` occurrences with `indexOf`, taking
  roughly a quarter off generation time per parser.
- **`@amritk/lint`** — `[?(...)]` filter bodies compile to closures once instead of
  being walked as an AST on every document node (still no `eval`/`new Function`;
  these are ordinary closures over the parsed tree), recursive descents ask which
  paths wanted each key the node has rather than asking every path in turn, and two
  `/^\d+$/` tests moved off the hot path. Linting the vendored real-world specs:
  petstore 11.1 → 7.4 ms, openai 1780 → 1110 ms.
