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

Measured on Node 22 with `benny`, one variant per process, against the
`typescript-runtime-type-benchmarks` payload and its four cases.

Reached through the generated barrel, compiled with `--module commonjs`:

| case | before | after | |
|---|--:|--:|--:|
| `parseSafe` | 28.2M | 43.4M | 1.54x |
| `parseStrict` | 23.1M | 27.7M | 1.20x |
| `assertLoose` | 61.5M | 137.2M | 2.23x |
| `assertStrict` | 32.4M | 45.0M | 1.39x |

Importing the module directly under ESM, where only the parser changes apply,
`parseSafe` goes 34.9M → 43.3M (1.24x) and the other three are unchanged.
