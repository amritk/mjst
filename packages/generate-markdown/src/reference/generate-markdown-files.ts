import { dereferenceSchema } from '#helpers/dereference'
import { isObject } from '#helpers/guards'
import { buildPages } from '#reference/build-pages'
import { flattenRoot } from '#reference/flatten-root'
import { readDocConfig } from '#reference/read-doc-config'
import { renderPage } from '#reference/render-page'
import type { GeneratedFile, MarkdownOptions } from '#types/doc'
import type { ConfigSchema } from '#types/schema'

/**
 * Renders a JSON Schema as prose documentation — a heading, a type, the
 * description and an example per property — and splits it across as many
 * markdown files as the schema's `x-doc.pages` declares.
 *
 * Everything the output says comes from the schema: the prose from
 * `description`, the structure from `x-doc.pages` / `x-doc.sections`, and the
 * code samples from `x-doc.example` (or derived from a property's `examples`).
 * That is the whole point — a hand-written configuration reference drifts from
 * the schema it documents, and this one cannot.
 *
 * Returns the files rather than writing them, so a caller can diff them in CI,
 * write them to a docs site, or hand them to `generateDocs`.
 *
 * @example
 * ```ts
 * const files = generateMarkdownFiles(schema, { language: 'javascript' })
 * // [{ filename: 'configuration.md', content: '# Configuration…' }, …]
 * ```
 */
export const generateMarkdownFiles = (schema: unknown, options: MarkdownOptions = {}): readonly GeneratedFile[] => {
  // A schema file holding `null` (or an array, or a string) parses fine, so the
  // renderers should produce an empty page rather than throw on a property read.
  const parsed = isObject(schema) ? schema : {}
  // `flattenRoot` runs after dereferencing, because a generated root often
  // reaches its branches through `$ref` and there would be nothing to flatten
  // before the refs are inlined.
  const dereferenced = flattenRoot(dereferenceSchema(parsed) as ConfigSchema)
  const config = readDocConfig(dereferenced, options)
  const pageFiles = new Map(config.pages.map((page) => [page.id, page.file]))
  return buildPages(dereferenced, config).map((model) => ({
    filename: model.page.file,
    content: renderPage(model, config, pageFiles),
  }))
}
