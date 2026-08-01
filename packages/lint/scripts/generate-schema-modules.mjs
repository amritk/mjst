import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'

// Regenerates the TypeScript modules that carry the vendored OpenAPI
// meta-schemas. The `.json` files stay the source of truth (see
// `src/rules/openapi/schemas/README.md` for where each one comes from); these
// modules are what the code actually imports.
//
// Why a generated module instead of importing the `.json` directly:
//
//   - `require(computedSpecifier)` — what this used to do — is invisible to every
//     bundler, so `@amritk/lint/rules/openapi` could not be bundled at all, and
//     `createRequire` does not exist on Workers or Deno.
//   - `import schema from './oas31.json' with { type: 'json' }` is bundler
//     friendly but needs Node >= 20.10, and the package supports Node >= 20.
//
// A plain `.ts` module has neither problem: it is a static import a bundler can
// follow, and it works on every runtime. The schema is stored as JSON *text* so
// module evaluation costs one string literal — the parse happens on first use, in
// `loadOasSchema`.
//
// Run from the package root: `node scripts/generate-schema-modules.mjs`.

/** Directory holding both the vendored `.json` files and the generated modules. */
export const SCHEMA_DIRECTORY = 'src/rules/openapi/schemas'

/** The vendored schemas, by module/file basename. */
export const SCHEMA_NAMES = ['oas20', 'oas30', 'oas31', 'oas32']

/** The minified JSON text a module should carry for one vendored schema. */
const minifiedSchema = (name) =>
  JSON.stringify(JSON.parse(readFileSync(join(SCHEMA_DIRECTORY, `${name}.json`), 'utf-8')))

/** Fingerprint of the vendored `.json`, embedded in the module so the build can detect drift. */
export const schemaDigest = (name) => createHash('sha256').update(minifiedSchema(name)).digest('hex')

/** Reads the digest a generated module was built from, or `undefined` if there is no readable module. */
export const readSchemaModuleDigest = (name) => {
  try {
    const module = readFileSync(join(SCHEMA_DIRECTORY, `${name}.ts`), 'utf-8')
    return /source-sha256: ([0-9a-f]{64})/.exec(module)?.[1]
  } catch {
    return undefined
  }
}

/**
 * Renders the module for one vendored schema. The literal is single-quoted with
 * only backslashes and apostrophes escaped, which is exactly what the formatter
 * would produce for JSON text, so regenerating never fights `biome format`.
 */
export const renderSchemaModule = (name) => {
  const minified = minifiedSchema(name)
  const literal = `'${minified.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  return [
    `// Generated from ./${name}.json by scripts/generate-schema-modules.mjs — do not edit.`,
    `// source-sha256: ${schemaDigest(name)}`,
    '',
    `/** The vendored OpenAPI meta-schema from \`${name}.json\`, as JSON text. Parsed on first use. */`,
    `export const ${name}Json = ${literal}`,
    '',
  ].join('\n')
}

if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
  for (const name of SCHEMA_NAMES) {
    const module = renderSchemaModule(name)
    writeFileSync(join(SCHEMA_DIRECTORY, `${name}.ts`), module)
    console.log(`generated ${SCHEMA_DIRECTORY}/${name}.ts (${module.length} bytes)`)
  }
}
