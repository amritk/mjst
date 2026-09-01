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
- **The remaining no-extras test stopped allocating.** `Object.getPrototypeOf(x)
  === Object.prototype && Object.keys(x).length === N` becomes
  `hasExactKeyCount(x, N)`, a new runtime helper that answers exactly the same
  question by counting with `for..in` and bailing at the first key past the
  budget. Same verdict for every input, including the prototype guard.
- **A single-use nested sub-parser's fast path is inlined at its one call
  site,** with the call kept for everything it does not cover. The expansion is
  one level deep by construction and capped per parser.
- **Generated `index.ts` barrels re-export values as `const` aliases.**
  TypeScript lowers `export { x } from './x.js'` to a CommonJS *accessor*, so a
  CJS consumer paid a property getter on every call through the barrel; the alias
  form lowers to a plain data property. Types keep the `export type { … } from`
  form. Both forms tree-shake identically in esbuild and rollup.

Measured on Node 22 (best of 7 per process, median of five paired rounds) against
the `typescript-runtime-type-benchmarks` payload — reached through the generated
barrel under `--module commonjs`: safe parse 1.71x, strict parse 1.45x, loose
assertion 3.91x, strict assertion 1.32x. Importing the module directly under ESM:
safe parse 1.32x, strict parse 1.09x.
