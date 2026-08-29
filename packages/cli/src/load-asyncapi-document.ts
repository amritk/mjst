import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assignKey } from '@amritk/helpers/assign-key'
import { readKey } from '@amritk/helpers/read-key'
import type { JsonPath, OriginMap } from '@amritk/resolve-refs'
import { resolveRefsFromFile } from '@amritk/resolve-refs'
import { parseDocument } from '@amritk/yaml'

import type { CliConfig } from './cli-config'
import { hasExternalRefs } from './has-external-refs'
import { buildResolveOptions, formatResolveErrors } from './resolve-policy'

/**
 * Parses one document's text by its location: `.json` through `JSON.parse`,
 * everything else through `@amritk/yaml` — YAML is a JSON superset, so the
 * fallback also covers a `.txt` or extensionless JSON file (the same rule the
 * lint resolver applies). A leading UTF-8 byte-order mark is stripped first:
 * `readFile`'s utf-8 decode keeps it, and `JSON.parse` fails on it with an
 * error naming an invisible character. YAML parse problems are collected
 * rather than thrown, so they are surfaced here: generating from the salvage
 * of a malformed document would silently drop the channels that failed to
 * parse.
 */
const parseDocumentText = (content: string, location: string): unknown => {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  if (/\.json$/i.test(location)) return JSON.parse(text)
  const doc = parseDocument(text)
  if (doc.errors.length > 0) {
    const details = doc.errors
      .slice(0, 5)
      .map((error) => `  - ${error.message}`)
      .join('\n')
    throw new Error(`Failed to parse ${location} as YAML:\n${details}`)
  }
  // The parser reads only the first document of a `---` stream and flags the
  // rest with a warning; generating from half a file while exiting 0 would
  // silently drop every channel in the later documents.
  if (doc.warnings.some((warning) => warning.code === 'MULTIPLE_DOCUMENTS')) {
    throw new Error(
      `${location} contains multiple YAML documents; an AsyncAPI document must be a single-document file.`,
    )
  }
  return doc.toJS()
}

/** Walks a resolver `JsonPath` down a plain JSON tree. */
const nodeAt = (root: unknown, pointer: JsonPath): unknown => {
  let node: unknown = root
  for (const segment of pointer) {
    if (Array.isArray(node)) {
      node = node[typeof segment === 'number' ? segment : Number(segment)]
    } else if (typeof node === 'object' && node !== null) {
      node = readKey(node as Record<string, unknown>, String(segment))
    } else {
      return undefined
    }
  }
  return node
}

/**
 * Restores object identity between a ref-inlined copy and the node the
 * resolved tree holds at the copy's source path.
 *
 * The resolver shares one object per repeated `$ref` target, but the target's
 * own home position (say `channels.events`) is rebuilt structurally — a
 * *different* object. An AsyncAPI 3.0 operation's `channel: {$ref:
 * '#/channels/events'}` therefore comes back as an object that neither
 * carries the `$ref` string nor coincides with the channels-map entry, and
 * the extractor's identity matching — its only remaining tool once the refs
 * are inlined — loses every direction (with a spurious "does not resolve"
 * issue) the moment a document contains one cross-file ref. Re-aiming each
 * same-document copy at the node the tree holds on that path makes the two
 * sides one object again.
 */
const canonicalizeAliases = (resolved: unknown, origins: OriginMap, rootLocation: string): void => {
  const canonical = new Map<object, object>()
  for (const [copy, origin] of origins) {
    if (origin.location !== rootLocation) continue
    const target = nodeAt(resolved, origin.pointer)
    if (typeof target === 'object' && target !== null && target !== copy) canonical.set(copy, target)
  }
  if (canonical.size === 0) return

  const seen = new Set<object>()
  const rewrite = (node: unknown): void => {
    if (typeof node !== 'object' || node === null || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index++) {
        const value: unknown = node[index]
        const replacement = typeof value === 'object' && value !== null ? canonical.get(value) : undefined
        if (replacement !== undefined) node[index] = replacement
        else rewrite(value)
      }
      return
    }
    for (const [key, value] of Object.entries(node)) {
      const replacement = typeof value === 'object' && value !== null ? canonical.get(value) : undefined
      if (replacement !== undefined) assignKey(node as Record<string, unknown>, key, replacement)
      else rewrite(value)
    }
  }
  rewrite(resolved)
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

  const { resolved, errors, origins } = await resolveRefsFromFile(documentPath, {
    ...buildResolveOptions(config, documentPath),
    parse: parseDocumentText,
    trackOrigins: true,
  })
  if (errors.length > 0) throw new Error(formatResolveErrors(documentPath, errors))
  if (origins !== undefined) canonicalizeAliases(resolved, origins, resolve(documentPath))
  return resolved
}
