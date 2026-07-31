import { join } from 'node:path'
import { buildExampleSchema } from '@amritk/generate-examples'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import type { OutputWriter } from './create-output-writer'

/**
 * Inputs for {@link emitExamples}. The schema and its root type name are the same
 * ones handed to the parser generator, so the arbitraries/examples line up with
 * the parsers that consume them.
 */
export type EmitExamplesOptions = {
  readonly schema: JSONSchema
  readonly rootTypeName: string
  /**
   * The run's writer, rooted at the output destination. Examples used to be
   * written straight to disk with `mkdir` + `writeFile`, which meant the one
   * output tree mjst emits that skipped the ownership check — a hand-written
   * `examples/index.ts` was overwritten without a word. Taking the writer instead
   * of a directory makes that impossible to reintroduce: there is no path here
   * that does not go through staging, the manifest, and `--force`.
   */
  readonly writer: OutputWriter
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
 * Stages fast-check arbitrary + concrete example files for one schema into an
 * `examples/` subdirectory of the writer's root.
 *
 * The dedicated subdirectory keeps the test-data output from colliding with the
 * parser files, which otherwise share the same `<name>.ts` / `index.ts` names.
 * Each generated file exports a `FooArbitrary` (a `fast-check` arbitrary that
 * produces schema-valid values) and a static `fooExample` value; an `index.ts`
 * barrel re-exports them. The arbitraries import `fast-check`, which consumers
 * must install as a (dev) dependency.
 *
 * Nothing lands on disk until the caller commits the writer, so a schema that
 * fails part-way through leaves no half-written `examples/` tree behind.
 *
 * @returns The staged file paths, relative to the writer's root.
 */
export const emitExamples = async (options: EmitExamplesOptions): Promise<string[]> => {
  const { schema, rootTypeName, writer, subDir = '', typeSuffix, bannerPrefix = '' } = options

  const files = await buildExampleSchema(schema, rootTypeName, typeSuffix)
  const staged: string[] = []

  for (const file of files) {
    const relativePath = join('examples', subDir, file.filename)
    await writer.stage(relativePath, bannerPrefix + file.content)
    staged.push(relativePath)
  }

  return staged
}
