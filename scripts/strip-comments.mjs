import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transformSync } from 'esbuild'

// Strips comments from the compiled JS in dist. The sources are heavily
// documented, and tsgo copies every JSDoc block into the .js output — roughly
// 40% of the emitted bytes — even though the docs already ship in the .d.ts
// files, which editors use for hover help. We reprint the JS through esbuild
// (no minification, no downleveling) instead of tsgo's removeComments because
// removeComments also strips JSDoc from the declaration files and drops
// semantic /* @__PURE__ */ annotations; esbuild keeps both the annotations
// and the shebang line. Runs after the TypeScript build from the package
// root: `node ../../scripts/strip-comments.mjs [dir]` (defaults to dist).
const root = process.argv[2] ?? 'dist'

const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(path)
    } else if (entry.name.endsWith('.js')) {
      const source = readFileSync(path, 'utf-8')
      const { code } = transformSync(source, { loader: 'js', format: 'esm' })
      writeFileSync(path, code)
    }
  }
}

walk(root)
