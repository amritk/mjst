import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { parse as parseYaml } from '@amritk/yaml'

/** Root directory holding the vendored AsyncAPI documents. */
const FIXTURES_DIR = new URL('.', import.meta.url).pathname

/** A single vendored AsyncAPI document, parsed into a plain JS value. */
export type AsyncApiFixture = {
  /** Path relative to the fixtures directory, e.g. `v3.0/streetlights-kafka.yaml`. */
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
 * Load every vendored AsyncAPI document, parsed with our own tooling
 * (`@amritk/yaml` for YAML, the platform `JSON.parse` for JSON). Sorted by name
 * so test output is stable. See `README.md` for the provenance of each file.
 */
export const loadAsyncApiFixtures = (): AsyncApiFixture[] =>
  listSpecFiles(FIXTURES_DIR)
    .sort()
    .map((file) => {
      const source = readFileSync(file, 'utf8')
      const format = extname(file) === '.json' ? 'json' : 'yaml'
      const document = (format === 'json' ? JSON.parse(source) : parseYaml(source)) as Record<string, unknown>
      return { name: relative(FIXTURES_DIR, file), format, source, document }
    })
