import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const root = process.cwd().includes('/packages/') ? resolve(process.cwd(), '../..') : process.cwd()

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${resolve(process.cwd(), 'src')}/` },
      { find: /^@amritk\/adapters\/(.*)$/, replacement: resolve(root, 'packages/adapters/src/$1.ts') },
      // api can be consumed from src: its only runtime dependency,
      // @amritk/runtime-validators, is aliased to dist below.
      { find: /^@amritk\/api$/, replacement: resolve(root, 'packages/api/src/index.ts') },
      { find: /^@amritk\/api\/bundler$/, replacement: resolve(root, 'packages/api/src/bundler/index.ts') },
      { find: /^@amritk\/api\/dev$/, replacement: resolve(root, 'packages/api/src/dev/index.ts') },
      { find: /^@amritk\/helpers\/(.*)$/, replacement: resolve(root, 'packages/helpers/src/$1.ts') },
      { find: /^@amritk\/generate-examples$/, replacement: resolve(root, 'packages/generate-examples/src/index.ts') },
      { find: /^@amritk\/generate-markdown$/, replacement: resolve(root, 'packages/generate-markdown/src/index.ts') },
      { find: /^@amritk\/generate-parsers$/, replacement: resolve(root, 'packages/generate-parsers/src/index.ts') },
      {
        find: /^@amritk\/generate-validators$/,
        replacement: resolve(root, 'packages/generate-validators/src/index.ts'),
      },
      // Consumed from its built dist (not src): runtime-validators uses `@/` path
      // aliases internally, which only resolve once `tsc-alias` has rewritten them
      // to relative paths in `dist`. Requires a prior build (see root `pretest`).
      // Subpaths first: the bare-name rule below would otherwise never be reached
      // for them, and both resolve to dist for the reason above.
      {
        find: /^@amritk\/runtime-validators\/parse$/,
        replacement: resolve(root, 'packages/runtime-validators/dist/parse/index.js'),
      },
      {
        find: /^@amritk\/runtime-validators$/,
        replacement: resolve(root, 'packages/runtime-validators/dist/index.js'),
      },
      { find: /^@amritk\/asyncapi$/, replacement: resolve(root, 'packages/asyncapi/src/index.ts') },
      { find: /^@amritk\/resolve-refs$/, replacement: resolve(root, 'packages/resolve-refs/src/index.ts') },
      { find: /^@amritk\/yaml$/, replacement: resolve(root, 'packages/yaml/src/index.ts') },
      // The types subpath must resolve to source too (more specific first).
      { find: /^@amritk\/lint\/types$/, replacement: resolve(root, 'packages/lint/src/core/types.ts') },
      {
        find: /^@amritk\/lint\/rules\/openapi$/,
        replacement: resolve(root, 'packages/lint/src/rules/openapi/index.ts'),
      },
      {
        find: /^@amritk\/lint\/rules\/asyncapi$/,
        replacement: resolve(root, 'packages/lint/src/rules/asyncapi/index.ts'),
      },
      { find: /^@amritk\/lint$/, replacement: resolve(root, 'packages/lint/src/index.ts') },
    ],
  },
  test: {
    include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx'],
    // `bun run test` fans out one vitest instance per workspace package, so a
    // heavy test (the api differential corpus, the codegen-then-compile suites)
    // competes with eleven siblings for the same cores. Under that load the 5s
    // default measures machine contention rather than correctness — the api
    // corpus test took 6.0s and went red while passing in 1.8s on its own. A
    // wider budget still catches a genuine hang.
    testTimeout: 30_000,
  },
})
