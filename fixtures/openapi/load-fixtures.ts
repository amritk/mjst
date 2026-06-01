import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { resolveRefs } from '@amritk/resolve-refs'
import { parse as parseYaml } from '@amritk/yaml'

/** Root directory holding the vendored OpenAPI documents. */
const FIXTURES_DIR = new URL('.', import.meta.url).pathname

/** A single vendored OpenAPI document, parsed into a plain JS value. */
export type OpenApiFixture = {
  /** Path relative to the fixtures directory, e.g. `v3.0/petstore.yaml`. */
  name: string
  /** On-disk format of the vendored file. */
  format: 'yaml' | 'json'
  /** Raw, byte-for-byte file contents as fetched from upstream. */
  source: string
  /** The parsed document (YAML/JSON projected to plain JS). */
  document: Record<string, unknown>
}

const SPEC_EXTENSIONS = new Set(['.yaml', '.yml', '.json'])

/** Recursively collect every spec file path under the fixtures directory. */
const listSpecFiles = (dir: string): string[] => {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...listSpecFiles(full))
    else if (SPEC_EXTENSIONS.has(extname(entry.name))) found.push(full)
  }
  return found
}

/**
 * Load every vendored OpenAPI document, parsed with our own tooling
 * (`@amritk/yaml` for YAML, the platform `JSON.parse` for JSON). Sorted by name
 * so test output is stable. See `README.md` for the provenance of each file.
 */
export const loadOpenApiFixtures = (): OpenApiFixture[] =>
  listSpecFiles(FIXTURES_DIR)
    .sort()
    .map((file) => {
      const source = readFileSync(file, 'utf8')
      const format = extname(file) === '.json' ? 'json' : 'yaml'
      const document = (format === 'json' ? JSON.parse(source) : parseYaml(source)) as Record<string, unknown>
      return { name: relative(FIXTURES_DIR, file), format, source, document }
    })

/** The `components.schemas` of one fixture, with internal `$ref`s inlined. */
export type FixtureSchemas = {
  /** The owning fixture's name, e.g. `v3.0/petstore.yaml`. */
  fixture: string
  /** Each reusable schema keyed by its `components.schemas` name. */
  schemas: { name: string; schema: unknown }[]
}

/**
 * Extract the reusable schemas from each fixture's `components.schemas`, with
 * internal `$ref`s resolved (via `@amritk/resolve-refs`) so every schema is
 * self-contained and can be fed to a generator on its own. Fixtures with no
 * inline schemas (e.g. DigitalOcean, whose schemas live behind external file
 * refs) are omitted — they still exercise the YAML and ref-resolution suites.
 */
export const loadComponentSchemas = (): FixtureSchemas[] => {
  const result: FixtureSchemas[] = []
  for (const fixture of loadOpenApiFixtures()) {
    const { resolved } = resolveRefs(fixture.document)
    const components = (resolved as { components?: { schemas?: Record<string, unknown> } }).components
    const schemas = Object.entries(components?.schemas ?? {}).map(([name, schema]) => ({ name, schema }))
    if (schemas.length > 0) result.push({ fixture: fixture.name, schemas })
  }
  return result
}
