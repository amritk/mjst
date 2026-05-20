import { isObject } from './is-object'

/**
 * Converts an arbitrary title string into a PascalCase TypeScript identifier.
 * Splits on any run of non-alphanumeric characters, capitalizes the first
 * letter of each word while preserving the rest (so acronyms like "API" or
 * "JSON" survive intact), and drops leading digits since an identifier may not
 * start with a number.
 */
const titleToPascalCase = (title: string): string => {
  const words = title.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  const pascal = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('')
  return pascal.replace(/^\d+/, '')
}

/**
 * Derives the root type name for a generated schema from its `title` keyword.
 *
 * We name the root after the schema itself instead of a generic "Document" so
 * the generated types and parsers read naturally (e.g. an OpenAPI schema yields
 * `OpenApi` / `parseOpenApi`). When the schema has no usable `title`, we fall
 * back to "Document" to keep output deterministic.
 *
 * @param schema - The root JSON Schema. A boolean schema or one without a
 *   string `title` falls back to the default.
 * @returns A PascalCase type name derived from the title, or "Document".
 *
 * @example
 * ```ts
 * deriveRootTypeName({ title: 'OpenAPI Document' }) // 'OpenAPIDocument'
 * deriveRootTypeName({ title: 'my-config' }) // 'MyConfig'
 * deriveRootTypeName({ type: 'object' }) // 'Document'
 * ```
 */
export const deriveRootTypeName = (schema: unknown): string => {
  if (!isObject(schema) || typeof schema['title'] !== 'string') {
    return 'Document'
  }

  const name = titleToPascalCase(schema['title'])
  return name || 'Document'
}
