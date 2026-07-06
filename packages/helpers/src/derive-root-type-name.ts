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
 * Derives the root type name for a generated schema.
 *
 * We name the root after the schema itself instead of a generic "Document" so
 * the generated types and parsers read naturally (e.g. an OpenAPI schema yields
 * `OpenApi` / `parseOpenApi`, and a `spec-plan.json` file yields `SpecPlan` /
 * `parseSpecPlan`). The schema's `title` keyword wins when present; otherwise
 * the caller can supply the schema's filename (without extension) as a
 * `fallbackName` so the name still reflects the source. When neither yields a
 * usable identifier we fall back to "Document" to keep output deterministic.
 *
 * @param schema - The root JSON Schema. A boolean schema or one without a
 *   string `title` uses `fallbackName`.
 * @param fallbackName - Optional name (typically the schema's base filename)
 *   used when the schema has no usable `title`. PascalCased the same way.
 * @returns A PascalCase type name derived from the title or fallback, or
 *   "Document".
 *
 * @example
 * ```ts
 * deriveRootTypeName({ title: 'OpenAPI Document' }) // 'OpenAPIDocument'
 * deriveRootTypeName({ title: 'my-config' }) // 'MyConfig'
 * deriveRootTypeName({ type: 'object' }, 'spec-plan') // 'SpecPlan'
 * deriveRootTypeName({ type: 'object' }) // 'Document'
 * ```
 */
export const deriveRootTypeName = (schema: unknown, fallbackName?: string): string => {
  if (isObject(schema) && typeof schema['title'] === 'string') {
    const fromTitle = titleToPascalCase(schema['title'])
    if (fromTitle) return fromTitle
  }

  if (typeof fallbackName === 'string') {
    const fromFilename = titleToPascalCase(fallbackName)
    if (fromFilename) return fromFilename
  }

  return 'Document'
}
