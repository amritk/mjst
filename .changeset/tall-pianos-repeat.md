---
'@amritk/generate-parsers': minor
'@amritk/generate-validators': minor
'@amritk/generate-examples': minor
'@amritk/helpers': minor
'@amritk/mjst': minor
---

Cut the hot-path cost of generated parsers and of every barrel a CommonJS
consumer calls through.

- **Strip builds no longer prove "no undeclared key" before their fast path.**
  A strip build returns a literal naming only the declared properties, so an
  extra is dropped by construction and proving its absence first bought nothing.
  Parsers that must *reject* an extra keep the proof. **This is an observable
  change:** a stripping parser used to hand a clean nested object or array
  element back by reference, so `parse(x).nested === x.nested`; it is now always
  a fresh object. For a parser whose job is to strip, that is the safer default —
  a caller mutating the result can no longer reach the input.
- **A single-use nested sub-parser's fast path is inlined at its one call
  site,** with the call kept for everything it does not cover. The expansion is
  one level deep by construction and capped per parser.
- **Generated `index.ts` barrels re-export values as `const` aliases.**
  TypeScript lowers `export { x } from './x.js'` to a CommonJS *accessor*, so a
  CJS consumer paid a property getter on every call through the barrel; the alias
  form lowers to a plain data property. Types keep the `export type { … } from`
  form. Both forms tree-shake identically in esbuild and rollup.

Measured on Node 22 with `benny`, one variant per process, median of five, on
the `typescript-runtime-type-benchmarks` payload and its four cases, with each
result consumed so nothing is eliminated as dead. Reached through the generated
barrel, compiled with `--module commonjs`:

| case | before | after | |
|---|--:|--:|--:|
| `parseSafe` | 27.9M | 44.0M | 1.58x |
| `parseStrict` | 22.8M | 27.8M | 1.22x |
| `assertLoose` | 57.0M | 134.8M | 2.36x |
| `assertStrict` | 32.3M | 43.8M | 1.36x |

Importing the module directly under ESM, where only the parser changes apply,
`parseSafe` goes 34.1M → 41.4M (1.21x) and the other three are unchanged.

Absolute figures are machine-specific and two ceilings bound them: an empty
benchmark case measures ~115M ops/s here, so `assertLoose` is already reporting
the harness rather than the validator; and a parse whose result is discarded (as
the harness discards it) has its allocation scalar-replaced, which flatters every
`parse*` number. Forcing the result to escape, `parseSafe` reads 30.8M → 37.2M
against 50.2M for a hand-written parser — 61% of hand-written before, 74% after.
