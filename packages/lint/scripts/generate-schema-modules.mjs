import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'

// Regenerates the TypeScript modules that carry the vendored OpenAPI and
// AsyncAPI meta-schemas. The `.json` files stay the source of truth (see the
// `README.md` in each schema directory for where every file comes from and which
// adaptations it carries); these modules are what the code actually imports.
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
// `loadOasSchema` / `loadAsyncApiSchema`.
//
// Run from the package root: `node scripts/generate-schema-modules.mjs`.

/**
 * The vendored schema sets: a directory holding both the `.json` files and the
 * generated modules, the spec they describe, and the module/file basenames.
 */
export const SCHEMA_SETS = [
  { directory: 'src/rules/openapi/schemas', spec: 'OpenAPI', names: ['oas20', 'oas30', 'oas31', 'oas32'] },
  {
    directory: 'src/rules/asyncapi/schemas',
    spec: 'AsyncAPI',
    names: ['aas20', 'aas21', 'aas22', 'aas23', 'aas24', 'aas25', 'aas26', 'aas30'],
  },
]

/** Every vendored schema as a `{ set, name }` pair, flattened across the sets. */
export const allSchemas = () => SCHEMA_SETS.flatMap((set) => set.names.map((name) => ({ set, name })))

/** The path of one vendored `.json`, or its generated `.ts`, relative to the package root. */
export const schemaPath = (set, name, extension) => join(set.directory, `${name}.${extension}`)

/** The minified JSON text a module should carry for one vendored schema. */
const minifiedSchema = (set, name) => JSON.stringify(JSON.parse(readFileSync(schemaPath(set, name, 'json'), 'utf-8')))

/** Fingerprint of the vendored `.json`, embedded in the module so the build can detect drift. */
export const schemaDigest = (set, name) => createHash('sha256').update(minifiedSchema(set, name)).digest('hex')

/** Reads the digest a generated module was built from, or `undefined` if there is no readable module. */
export const readSchemaModuleDigest = (set, name) => {
  try {
    const module = readFileSync(schemaPath(set, name, 'ts'), 'utf-8')
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
export const renderSchemaModule = (set, name) => {
  const minified = minifiedSchema(set, name)
  const literal = `'${minified.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  return [
    `// Generated from ./${name}.json by scripts/generate-schema-modules.mjs — do not edit.`,
    `// source-sha256: ${schemaDigest(set, name)}`,
    '',
    `/** The vendored ${set.spec} meta-schema from \`${name}.json\`, as JSON text. Parsed on first use. */`,
    `export const ${name}Json = ${literal}`,
    '',
  ].join('\n')
}

if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
  for (const { set, name } of allSchemas()) {
    const module = renderSchemaModule(set, name)
    writeFileSync(schemaPath(set, name, 'ts'), module)
    console.log(`generated ${schemaPath(set, name, 'ts')} (${module.length} bytes)`)
  }
}
