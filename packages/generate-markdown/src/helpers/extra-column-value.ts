import { escapeHtml } from '#helpers/escape-html'
import type { SchemaProperty } from '#types/schema'

/**
 * Reads one extra column's value off a property and renders it for the cell.
 *
 * Only scalars are rendered: a string (the usual case — a label such as
 * `experimental`), a number, or a boolean. An object or an array would need a
 * layout decision this package has no way to make, and `[object Object]` in a
 * cell helps nobody, so anything else leaves the cell empty — which is also what
 * makes the column disappear when no property fills it.
 *
 * The value is schema-controlled text, so it is escaped rather than
 * interpolated: an unescaped `<` or `&` injects raw markup into the table.
 */
export const extraColumnValue = (prop: SchemaProperty, key: string): string => {
  // An extra column names its keyword at run time, so the lookup cannot go
  // through the members `SchemaProperty` knows about.
  const value = (prop as Readonly<Record<string, unknown>>)[key]
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return ''
  return escapeHtml(String(value))
}
