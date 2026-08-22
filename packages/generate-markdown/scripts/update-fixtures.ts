import { readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { generateDocs } from '#reference/generate-docs'

/**
 * Regenerates the golden markdown under `fixtures/expected/`, which
 * `generate-markdown-files.test.ts` compares against. Run it after a
 * deliberate change to the renderer (or to a fixture schema) and read the diff
 * — that diff *is* the review: it shows exactly how the docs of every adopter
 * would change.
 *
 * ```sh
 * bun run generate-fixtures
 * ```
 */
const FIXTURES = ['api-reference-config', 'sdk-config'] as const

const root = resolve(import.meta.dirname, '..')

for (const name of FIXTURES) {
  const outDir = resolve(root, 'fixtures/expected', name)
  // Removed first so a page that no longer exists does not linger as a golden
  // nothing generates any more.
  await rm(outDir, { recursive: true, force: true })
  const files = await generateDocs({
    schemaPath: resolve(root, 'fixtures', `${name}.schema.json`),
    outDir,
  })
  console.log(`${name}: ${files.map((file) => file.filename).join(', ')}`)
}

console.log(`fixtures/expected: ${(await readdir(resolve(root, 'fixtures/expected'))).join(', ')}`)
