import { isObject } from './is-object'
import { readKey } from './read-key'
import { isIdentifierStart, toPascalWords } from './ref-to-name'

/**
 * Converts an arbitrary title string into a PascalCase TypeScript identifier.
 *
 * Word splitting and capitalization come from {@link toPascalWords}, the same
 * pass `refToName` uses, so a root type and a `$ref` to a definition of the
 * same name cannot be spelled differently — and so a non-ASCII title survives
 * rather than being mangled away.
 *
 * Leading digits are *dropped* rather than prefixed with `_` the way `refToName`
 * does: a title is prose, so "3 amigos" reads as `Amigos`. Anything else that
 * cannot begin an identifier (a leading combining mark, say) gets the `_`
 * prefix, and an empty result is handed back empty so the caller can fall
 * through to its own fallback instead of being given `_`.
 */
const titleToPascalCase = (title: string): string => {
  const pascal = toPascalWords(title).replace(/^\d+/, '')
  if (pascal === '' || isIdentifierStart(pascal)) return pascal
  return `_${pascal}`
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
  // `readKey`: `title` read straight off the object answers from a polluted
  // `Object.prototype` too, which would name every generated root after it.
  const title = isObject(schema) ? readKey(schema, 'title') : undefined
  if (typeof title === 'string') {
    const fromTitle = titleToPascalCase(title)
    if (fromTitle) return fromTitle
  }

  if (typeof fallbackName === 'string') {
    const fromFilename = titleToPascalCase(fallbackName)
    if (fromFilename) return fromFilename
  }

  return 'Document'
}
