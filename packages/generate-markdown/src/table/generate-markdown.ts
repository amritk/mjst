import { generateConfigTable } from '#table/generate-config-table'

/**
 * Generates the properties table from the JSON Schema and writes it to README.md.
 * Every user-facing description comes from the schema so the two stay in sync —
 * update the schema, then run `bun run generate-readme`.
 *
 * The zero-argument shape is the point: this is the form a package's
 * `generate-readme` script runs from its own directory. Pointing the flow at
 * other paths is {@link generateConfigTable}, which this wraps.
 *
 * If README.md already exists and contains <!-- config-table-start --> and
 * <!-- config-table-end --> markers, only the content between those markers is
 * replaced. If it exists but is missing one or both markers we refuse to write
 * rather than destroy hand-written content. When no README exists yet the table
 * is written on its own.
 *
 * @example
 * ```ts
 * // Takes NO arguments and does its own file I/O: it reads ./config.schema.json
 * // from process.cwd() and writes ./README.md. Run it from the package directory.
 * await generateMarkdown()
 * ```
 */
export const generateMarkdown = async (): Promise<void> => {
  await generateConfigTable()
  console.log('README.md generated successfully.')
}
