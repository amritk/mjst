import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { buildExampleSchema } from '@amritk/generate-examples'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Inputs for {@link emitExamples}. The schema and its root type name are the same
 * ones handed to the parser generator, so the arbitraries/examples line up with
 * the parsers that consume them.
 */
export type EmitExamplesOptions = {
  readonly schema: JSONSchema
  readonly rootTypeName: string
  /** Output root; example files always land under `<outputDir>/examples/`. */
  readonly outputDir: string
  /**
   * Nested location of the schema relative to `--schema-dir` (e.g. `api/order`),
   * mirrored beneath `examples/` so each schema's test data sits beside where its
   * parsers were emitted. Defaults to `''` (single-schema output at the root).
   */
  readonly subDir?: string
  /** Suffix appended to every `$ref`-derived type/arbitrary name. Defaults to `''`. */
  readonly typeSuffix?: string
  /** Header comment (already wrapped in a JSDoc block) prepended to each file, or `''`. */
  readonly bannerPrefix?: string
}

/**
 * Emits fast-check arbitrary + concrete example files for one schema into an
 * `examples/` subdirectory of `outputDir`.
 *
 * The dedicated subdirectory keeps the test-data output from colliding with the
 * parser files, which otherwise share the same `<name>.ts` / `index.ts` names.
 * Each generated file exports a `FooArbitrary` (a `fast-check` arbitrary that
 * produces schema-valid values) and a static `fooExample` value; an `index.ts`
 * barrel re-exports them. The arbitraries import `fast-check`, which consumers
 * must install as a (dev) dependency.
 *
 * @returns The written file paths, relative to `outputDir`.
 */
export const emitExamples = async (options: EmitExamplesOptions): Promise<string[]> => {
  const { schema, rootTypeName, outputDir, subDir = '', typeSuffix, bannerPrefix = '' } = options

  const files = await buildExampleSchema(schema, rootTypeName, typeSuffix)
  const exampleDir = join(outputDir, 'examples', subDir)
  const written: string[] = []

  for (const file of files) {
    const filePath = join(exampleDir, file.filename)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, bannerPrefix + file.content, 'utf-8')
    written.push(relative(outputDir, filePath))
  }

  return written
}
