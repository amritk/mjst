import { cpSync, statSync } from 'node:fs'

// tsgo compiles the .ts sources but does not copy asset files, so the raw
// OpenAPI meta-schema .json documents (loaded via require() in
// src/rules/openapi/schemas/index.ts) must be copied next to the compiled
// output. Run after the TypeScript build. cwd is the package root.
const from = 'src/rules/openapi/schemas'
const to = 'dist/rules/openapi/schemas'
cpSync(from, to, {
  recursive: true,
  filter: (src) => statSync(src).isDirectory() || src.endsWith('.json'),
})
