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
      {
        find: /^@amritk\/runtime-validators$/,
        replacement: resolve(root, 'packages/runtime-validators/dist/index.js'),
      },
      { find: /^@amritk\/resolve-refs$/, replacement: resolve(root, 'packages/resolve-refs/src/index.ts') },
      { find: /^@amritk\/yaml$/, replacement: resolve(root, 'packages/yaml/src/index.ts') },
      // The types subpath must resolve to source too (more specific first, like mini below).
      { find: /^@amritk\/lint\/types$/, replacement: resolve(root, 'packages/lint/src/core/types.ts') },
      { find: /^@amritk\/lint$/, replacement: resolve(root, 'packages/lint/src/index.ts') },
      // mini's JSX transform emits `import { jsx } from '@amritk/mini/jsx-runtime'`,
      // so the runtime subpaths must resolve to source (more specific first).
      { find: /^@amritk\/mini\/jsx-runtime$/, replacement: resolve(root, 'packages/mini/src/jsx-runtime.ts') },
      { find: /^@amritk\/mini\/jsx-dev-runtime$/, replacement: resolve(root, 'packages/mini/src/jsx-dev-runtime.ts') },
      { find: /^@amritk\/mini$/, replacement: resolve(root, 'packages/mini/src/index.ts') },
    ],
  },
  test: {
    include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx'],
  },
})
