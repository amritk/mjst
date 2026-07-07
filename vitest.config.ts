import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const root = process.cwd().includes('/packages/') ? resolve(process.cwd(), '../..') : process.cwd()

// Resolve a `@/`-prefixed import against the *importing file's* own package `src`
// directory. This generalizes a fixed `${cwd}/src` alias so a package that uses
// `@/` internally (e.g. `@amritk/runtime-validators`) still resolves correctly
// when it is imported across package boundaries in a test run.
const resolveAtSlash = (sub: string, importer: string | undefined): string => {
  const match = importer?.match(/(.*\/packages\/[^/]+)\//)
  const base = match ? `${match[1]}/src` : resolve(process.cwd(), 'src')
  for (const candidate of [`${resolve(base, sub)}.ts`, resolve(base, sub, 'index.ts'), resolve(base, sub)]) {
    if (existsSync(candidate)) return candidate
  }
  return `${resolve(base, sub)}.ts`
}

export default defineConfig({
  plugins: [
    {
      name: 'at-slash-importer-aware',
      enforce: 'pre',
      resolveId(source, importer) {
        if (!source.startsWith('@/')) return null
        return resolveAtSlash(source.slice(2), importer)
      },
    },
  ],
  resolve: {
    alias: [
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
      { find: /^@amritk\/lint-parsers$/, replacement: resolve(root, 'packages/lint-parsers/src/index.ts') },
      { find: /^@amritk\/lint-core$/, replacement: resolve(root, 'packages/lint-core/src/index.ts') },
      { find: /^@amritk\/lint-functions$/, replacement: resolve(root, 'packages/lint-functions/src/index.ts') },
      { find: /^@amritk\/lint-formatters$/, replacement: resolve(root, 'packages/lint-formatters/src/index.ts') },
      { find: /^@amritk\/lint-fix$/, replacement: resolve(root, 'packages/lint-fix/src/index.ts') },
      { find: /^@amritk\/lint$/, replacement: resolve(root, 'packages/lint/src/index.ts') },
    ],
  },
  test: {
    include: ['packages/**/*.test.ts'],
  },
})
