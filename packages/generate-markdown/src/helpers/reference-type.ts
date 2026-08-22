import { displayType } from '#helpers/display-type'
import { formatInlineLiteral } from '#helpers/format-literal'
import { asArray, asSchema, isObject } from '#helpers/guards'
import { readDocMeta } from '#helpers/read-doc-meta'
import type { SchemaProperty } from '#types/schema'

/**
 * Joins type labels into a `a | b` union, dropping blanks and duplicates.
 *
 * A part that is itself a union is flattened first, or a union of a union
 * printed the same word twice — `object | string | object` for two
 * alternatives. Only a part with nothing to protect is split: a quoted enum
 * literal may hold a ` | ` of its own, and a bracketed array item (`(string |
 * number)[]`) means the opposite thing taken apart.
 */
const unionOf = (parts: readonly string[]): string =>
  [
    ...new Set(
      parts.filter((part) => part.length > 0).flatMap((part) => (/["'()[\]]/.test(part) ? [part] : part.split(' | '))),
    ),
  ].join(' | ')

/**
 * The **Type:** label for the prose reference style.
 *
 * It differs from the table renderer's {@link displayType} in two ways that
 * matter for a hand-written-looking reference:
 *
 * - an `enum` renders as a literal union (`'json' | 'yaml'`) rather than the
 *   flattened `string`, because the allowed values *are* the type a reader
 *   needs to know, and
 * - a typed array renders as `string[]` rather than `array`.
 *
 * `x-doc.type` wins over everything. Plenty of real config types — a callback
 * signature, a named TypeScript type — have no JSON Schema spelling at all, and
 * a docs generator that cannot say `(heading: Heading) => string` would just
 * push those properties back into a hand-maintained file.
 */
export const referenceType = (prop: SchemaProperty, language: string, depth = 0): string => {
  const override = readDocMeta(prop).type
  if (override !== undefined) return override
  // Guards a self-referential schema that survived dereferencing as a stub.
  if (depth > 8) return ''

  const values = asArray(prop.enum)
  if (values.length > 0) return unionOf(values.map((value) => formatInlineLiteral(value, language)))
  if (prop.const !== undefined) return formatInlineLiteral(prop.const, language)

  if (typeof prop.type === 'string') {
    if (prop.type !== 'array') return prop.type
    const items = Array.isArray(prop.items) ? prop.items[0] : prop.items
    const item = isObject(items) ? referenceType(asSchema(items), language, depth + 1) : ''
    // A union item needs brackets — `string | number[]` would read as the wrong
    // thing, so it becomes `(string | number)[]`.
    if (item.length === 0) return 'array'
    // `Alpha & Beta[]` is an intersection with an array, not an array of an
    // intersection — a different type, stated plainly.
    return item.includes(' | ') || item.includes(' & ') ? `(${item})[]` : `${item}[]`
  }
  if (Array.isArray(prop.type)) {
    return unionOf(prop.type.filter((entry): entry is string => typeof entry === 'string'))
  }

  for (const variants of [prop.anyOf, prop.oneOf]) {
    const union = unionOf(asArray(variants).map((variant) => referenceType(asSchema(variant), language, depth + 1)))
    if (union.length > 0) return union
  }
  // `allOf` means every branch applies, so its label is an intersection: `a & b`
  // and not `a | b`, which told the reader either would do. The one-branch
  // OpenAPI idiom — a `$ref` wrapped to carry a description — reads the same
  // either way, which is how it went unnoticed.
  const parts = [
    ...new Set(
      asArray(prop.allOf)
        .map((variant) => referenceType(asSchema(variant), language, depth + 1))
        .filter((part) => part.length > 0),
    ),
    // A branch that is itself a union needs brackets, or `&` binds tighter than
    // the `|` beside it and the label collapses back to the union it replaced:
    // `string | number & string` reads as `string | (number & string)`, which
    // is the answer this was written to stop giving.
  ].map((part) => (part.includes(' | ') ? `(${part})` : part))
  if (parts.length > 0) return parts.join(' & ')
  return displayType(prop)
}

/**
 * True when {@link referenceType} already spells out every allowed value, so a
 * separate **Allowed values:** line would just say it twice.
 */
export const typeShowsEnum = (prop: SchemaProperty): boolean =>
  readDocMeta(prop).type === undefined && asArray(prop.enum).length > 0
