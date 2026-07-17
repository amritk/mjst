---
'@amritk/adapters': patch
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

Packaging fixes across all published packages: the `types` export condition now precedes runtime conditions (`default`/`import`) so TypeScript resolves the declared `.d.ts` explicitly instead of relying on file adjacency, and published tarballs now include the LICENSE file (copied in during the publish job).
