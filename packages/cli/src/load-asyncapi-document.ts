import { readFile } from 'node:fs/promises'
import { resolveRefsFromFile } from '@amritk/resolve-refs'
import { parseDocument } from '@amritk/yaml'

import type { CliConfig } from './cli-config'
import { hasExternalRefs } from './has-external-refs'
import { buildResolveOptions, formatResolveErrors } from './resolve-policy'

/**
 * Parses one document's text by its location: `.json` through `JSON.parse`,
 * everything else through `@amritk/yaml` — YAML is a JSON superset, so the
 * fallback also covers a `.txt` or extensionless JSON file (the same rule the
 * lint resolver applies). YAML parse problems are collected rather than
 * thrown, so they are surfaced here: generating from the salvage of a
 * malformed document would silently drop the channels that failed to parse.
 */
const parseDocumentText = (content: string, location: string): unknown => {
  if (/\.json$/i.test(location)) return JSON.parse(content)
  const doc = parseDocument(content)
  if (doc.errors.length > 0) {
    const details = doc.errors
      .slice(0, 5)
      .map((error) => `  - ${error.message}`)
      .join('\n')
    throw new Error(`Failed to parse ${location} as YAML:\n${details}`)
  }
  return doc.toJS()
}

/**
 * Reads and parses an AsyncAPI document (JSON or YAML) off disk. When the
 * document carries cross-file or remote `$ref`s, the whole document is
 * dereferenced with `@amritk/resolve-refs` under the same policy flags as JSON
 * Schema input — offline by default, SSRF-guarded, confined to the document's
 * directory. A document with only same-document `#/...` references (the common
 * case) skips that pass entirely: the extractor follows them itself, and keeps
 * `#/components/schemas/...` pointers *as names* so the generators emit one
 * type per component instead of an inlined blob.
 */
export const loadAsyncApiDocument = async (config: Partial<CliConfig>, documentPath: string): Promise<unknown> => {
  const document = parseDocumentText(await readFile(documentPath, 'utf-8'), documentPath)
  if (!hasExternalRefs(document)) return document

  const { resolved, errors } = await resolveRefsFromFile(documentPath, {
    ...buildResolveOptions(config, documentPath),
    parse: parseDocumentText,
  })
  if (errors.length > 0) throw new Error(formatResolveErrors(documentPath, errors))
  return resolved
}
