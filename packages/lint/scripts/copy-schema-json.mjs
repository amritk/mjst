import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// tsgo compiles the .ts sources but does not copy asset files, so the raw
// OpenAPI meta-schema .json documents (loaded via require() in
// src/rules/openapi/schemas/index.ts) must be copied next to the compiled
// output. The sources stay pretty-printed for reviewability, but the copies
// are minified — JSON.parse does not care, and it roughly halves the bytes
// these schemas add to the published package. Run after the TypeScript
// build. cwd is the package root.
const from = 'src/rules/openapi/schemas'
const to = 'dist/rules/openapi/schemas'
mkdirSync(to, { recursive: true })
for (const name of readdirSync(from)) {
  if (!name.endsWith('.json')) continue
  const document = JSON.parse(readFileSync(join(from, name), 'utf-8'))
  writeFileSync(join(to, name), JSON.stringify(document))
}
