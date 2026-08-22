import { exit } from 'node:process'

import { allSchemas, readSchemaModuleDigest, schemaDigest, schemaPath } from './generate-schema-modules.mjs'

// The OpenAPI meta-schemas used to be raw `.json` files copied next to the
// compiled output and pulled in with `require()`. That made the package
// impossible to bundle (a computed `require` specifier is invisible to a
// bundler) and broken on Workers and Deno, so the schemas — OpenAPI's and
// AsyncAPI's alike — now live in generated `.ts` modules that compile into
// `dist` like any other source file; nothing is left to copy.
//
// What is left to check is drift: the generated modules are derived from the
// vendored `.json` files, so a refreshed schema that nobody regenerated would
// silently publish the old bytes. This step runs in the build (still under its
// original file name, since the package manifest that invokes it is owned
// elsewhere) and fails loudly instead. cwd is the package root.
//
// Drift is compared by digest rather than by exact text, so reformatting a
// generated module (quotes, line width) is never mistaken for a stale schema.
const schemas = allSchemas()
const stale = schemas.filter(({ set, name }) => readSchemaModuleDigest(set, name) !== schemaDigest(set, name))

if (stale.length > 0) {
  console.error(
    `${stale.map(({ set, name }) => schemaPath(set, name, 'ts')).join(', ')} ` +
      `${stale.length === 1 ? 'is' : 'are'} out of date with the vendored .json schema${stale.length === 1 ? '' : 's'}.\n` +
      'Run `node scripts/generate-schema-modules.mjs` from packages/lint and rebuild.',
  )
  exit(1)
}

console.log(`schema modules in sync (${schemas.length} files)`)
