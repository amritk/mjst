import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const root = process.cwd().includes('/packages/') ? resolve(process.cwd(), '../..') : process.cwd()

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${resolve(process.cwd(), 'src')}/` },
      { find: /^@amritk\/adapters\/(.*)$/, replacement: resolve(root, 'packages/adapters/src/$1.ts') },
      { find: /^@amritk\/helpers\/(.*)$/, replacement: resolve(root, 'packages/helpers/src/$1.ts') },
      { find: /^@amritk\/generate-examples$/, replacement: resolve(root, 'packages/generate-examples/src/index.ts') },
      { find: /^@amritk\/generate-markdown$/, replacement: resolve(root, 'packages/generate-markdown/src/index.ts') },
      { find: /^@amritk\/generate-parsers$/, replacement: resolve(root, 'packages/generate-parsers/src/index.ts') },
      {
        find: /^@amritk\/generate-validators$/,
        replacement: resolve(root, 'packages/generate-validators/src/index.ts'),
      },
      {
        find: /^@amritk\/runtime-validators$/,
        replacement: resolve(root, 'packages/runtime-validators/src/index.ts'),
      },
      { find: /^@amritk\/resolve-refs$/, replacement: resolve(root, 'packages/resolve-refs/src/index.ts') },
      { find: /^@amritk\/yaml$/, replacement: resolve(root, 'packages/yaml/src/index.ts') },
    ],
  },
  test: {
    include: ['packages/**/*.test.ts'],
  },
})
