---
'@amritk/generate-parsers': minor
---

Smaller generated parsers — the fast-path guard now calls the `validate{Type}Shape` predicate that already ships in the same file instead of inlining a byte-identical copy of the whole check chain. On the OpenAI OpenAPI spec (888 generated files) the bundled + minified output drops ~8% (703 kB → 645 kB); the duplicated guard chains were the single largest source of repeated bytes in generated code.

The substitution is proven safe per parser: the generator renders the shape predicate its guard would need and delegates only when it matches the emitted one byte-for-byte — composition keywords, conditional flattening, alias/union predicates, and stub validators all keep the inline guard exactly as before. Exported `additionalProperties: false` / `stripUnknown` parsers also keep it, because their literal-return fast path would otherwise pay double property reads (a measured 6–13% hot-path cost on the strict benches). With the guard delegated, the cached property reads move below the fast-path return, so clean input skips them entirely; benchmarks are within noise of the previous output across all parse cases.
