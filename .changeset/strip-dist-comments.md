---
'@amritk/adapters': patch
'@amritk/api': patch
'@amritk/mjst': patch
'@amritk/generate-examples': patch
'@amritk/generate-markdown': patch
'@amritk/generate-parsers': patch
'@amritk/generate-validators': patch
'@amritk/helpers': patch
'@amritk/lint': patch
'@amritk/resolve-refs': patch
'@amritk/runtime-validators': patch
'@amritk/yaml': patch
---

Slim published packages — comments are now stripped from the compiled JS in `dist` (they were duplicating the JSDoc that already ships in the `.d.ts` files, which is what editors read), and `@amritk/lint` now minifies its bundled OpenAPI meta-schema JSON documents. Unpacked size drops ~30% across the board (for example `@amritk/lint` 448 kB → 307 kB, `@amritk/generate-parsers` 293 kB → 191 kB) with no behavior change: declaration files keep their docs, `/* @__PURE__ */` annotations and the CLI shebang survive, and `@amritk/helpers` still ships its TypeScript sources for embedded mode.
