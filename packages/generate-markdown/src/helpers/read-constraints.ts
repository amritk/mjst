import { formatInlineLiteral } from '#helpers/format-literal'
import type { SchemaProperty } from '#types/schema'

/**
 * The validation keywords worth putting in front of a reader, in the order they
 * read best. They are not part of the type label and not part of the prose, so
 * without this line the docs would quietly drop the difference between "a
 * string" and "a string of at most 40 characters matching `^[a-z-]+$`".
 */
const NUMERIC_KEYWORDS = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
] as const satisfies readonly (keyof SchemaProperty)[]

/**
 * Reads the constraint keywords a property declares, formatted as
 * `keyword: value` fragments for the **Constraints:** line.
 */
export const readConstraints = (prop: SchemaProperty, language: string): readonly string[] => {
  const fragments: string[] = []
  if (typeof prop.format === 'string' && prop.format.length > 0) fragments.push(`format: ${prop.format}`)
  if (typeof prop.pattern === 'string' && prop.pattern.length > 0) fragments.push(`pattern: ${prop.pattern}`)
  for (const keyword of NUMERIC_KEYWORDS) {
    const value = prop[keyword]
    if (typeof value === 'number' && Number.isFinite(value)) {
      fragments.push(`${keyword}: ${formatInlineLiteral(value, language)}`)
    }
  }
  if (prop.uniqueItems === true) fragments.push('uniqueItems: true')
  return fragments
}
