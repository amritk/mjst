import { displayType } from '#helpers/display-type'
import { formatInlineLiteral } from '#helpers/format-literal'
import { asArray, asProperties, asSchema, isObject } from '#helpers/guards'
import { readDocMeta } from '#helpers/read-doc-meta'
import type { SchemaProperty } from '#types/schema'

/**
 * Splits a rendered label at its top level, on the separator given.
 *
 * Scanning rather than matching, because ` | ` means one thing between two
 * types and another inside a quoted enum literal (`'a | b'`) or a bracketed
 * array item (`(string | number)[]`). A substring test read both as unions: it
 * bracketed a single literal into a group, and split one that dedupe then ate
 * half of.
 */
const splitTopLevel = (label: string, separator: string): readonly string[] => {
  const parts: string[] = []
  let depth = 0
  let quote: string | undefined
  let start = 0
  for (let index = 0; index < label.length; index++) {
    const character = label[index]
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '(' || character === '[') depth += 1
    else if (character === ')' || character === ']') depth -= 1
    else if (depth === 0 && label.startsWith(separator, index)) {
      parts.push(label.slice(start, index))
      index += separator.length - 1
      start = index + 1
    }
  }
  parts.push(label.slice(start))
  return parts
}

/**
 * Joins type labels into a `a | b` union, dropping blanks and duplicates.
 *
 * A part that is itself a union is flattened first, or a union of a union
 * printed the same word twice — `object | string | object` for two
 * alternatives.
 */
const unionOf = (parts: readonly string[]): string =>
  [...new Set(parts.filter((part) => part.length > 0).flatMap((part) => splitTopLevel(part, ' | ')))].join(' | ')

/**
 * The **Type:** label for the prose reference style.
 *
 * It differs from the table renderer's {@link displayType} in two ways that
 * matter for a hand-written-looking reference:
 *
 * - an `enum` renders as a literal union (`'json' | 'yaml'`) rather than the
 *   flattened `string`, because the allowed values *are* the type a reader
 *   needs to know, and
 * - a typed array renders as `string[]` rather than `array`, and
 * - a map renders as `Record<string, T>` rather than `object`.
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
    if (prop.type === 'object') return mapType(prop, language, depth) ?? 'object'
    if (prop.type !== 'array') return prop.type
    const items = Array.isArray(prop.items) ? prop.items[0] : prop.items
    const item = isObject(items) ? referenceType(asSchema(items), language, depth + 1) : ''
    // A union item needs brackets — `string | number[]` would read as the wrong
    // thing, so it becomes `(string | number)[]`.
    if (item.length === 0) return 'array'
    // `Alpha & Beta[]` is an intersection with an array, not an array of an
    // intersection — a different type, stated plainly.
    const grouped = splitTopLevel(item, ' | ').length > 1 || splitTopLevel(item, ' & ').length > 1
    return grouped ? `(${item})[]` : `${item}[]`
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
  ].map((part) => (splitTopLevel(part, ' | ').length > 1 ? `(${part})` : part))
  if (parts.length > 0) return parts.join(' & ')
  // A node that never says `type: 'object'` is still a map when it describes
  // its values — the table renderer's fallback would call it nothing at all.
  return mapType(prop, language, depth) ?? displayType(prop)
}

/**
 * The label for a map-shaped object — one that describes its values through
 * `additionalProperties` / `patternProperties` rather than naming fields — or
 * undefined for an object that is not one.
 *
 * `object` for `environments: { additionalProperties: { type: 'string' } }`
 * said nothing about the values being strings, and `object` for a map of
 * `resourceConfig` left a reader to take the value's fields as the map's own:
 * nothing on the page said the key level existed. `Record<string, T>` is the
 * same courtesy `T[]` already extends to arrays. The value label is
 * `referenceType` again, so an `x-doc.type` on the value shape names it
 * (`Record<string, ResourceConfig>`) and a union of pattern shapes reads as
 * one.
 *
 * An object with named `properties` beside its extras is not a map — its rows
 * document the fields, and calling it a `Record` would hide them — and a value
 * shape with no label of its own (`additionalProperties: {}`) is left as
 * `object` rather than dressed up as `Record<string, unknown>`.
 */
const mapType = (prop: SchemaProperty, language: string, depth: number): string | undefined => {
  if (Object.keys(asProperties(prop.properties)).length > 0) return undefined
  const shapes = [prop.additionalProperties, ...Object.values(asProperties(prop.patternProperties))].filter(isObject)
  if (shapes.length === 0) return undefined
  const value = unionOf(shapes.map((shape) => referenceType(asSchema(shape), language, depth + 1)))
  return value.length > 0 ? `Record<string, ${value}>` : undefined
}

/**
 * True when {@link referenceType} already spells out every allowed value, so a
 * separate **Allowed values:** line would just say it twice.
 */
export const typeShowsEnum = (prop: SchemaProperty): boolean =>
  readDocMeta(prop).type === undefined && asArray(prop.enum).length > 0
