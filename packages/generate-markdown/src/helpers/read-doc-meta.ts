import { asText, isObject, stringExtension } from '#helpers/guards'
import type { DocExample, DocLayout, DocMeta, DocSort } from '#types/doc'

/** The one vendor extension the reference renderer reads. */
export const DOC_KEY = 'x-doc'

const LAYOUTS: readonly DocLayout[] = ['headings', 'table', 'none']
const SORTS: readonly DocSort[] = ['schema', 'alphabetical']

/**
 * Normalizes the several shapes an example may be written in. A single example
 * is the common case, so `x-doc.example` accepts a bare code string; a list
 * needs `x-doc.examples`. Both spellings accept both shapes, because guessing
 * wrong should not silently drop a code block from the docs.
 */
export const asExamples = (value: unknown): readonly DocExample[] => {
  if (value === undefined || value === null) return []
  const entries = Array.isArray(value) ? value : [value]
  return entries.flatMap((entry): readonly DocExample[] => {
    if (typeof entry === 'string') return entry.length > 0 ? [{ code: entry }] : []
    if (!isObject(entry)) return []
    const language = stringExtension(entry['language'])
    const caption = stringExtension(entry['caption'])
    const code = typeof entry['code'] === 'string' ? entry['code'] : undefined
    // `value: null` is a legitimate example, so presence is what counts here.
    const hasValue = Object.hasOwn(entry, 'value')
    if (code === undefined && !hasValue) return []
    return [
      {
        ...(language !== undefined && { language }),
        ...(caption !== undefined && { caption }),
        ...(code !== undefined && { code }),
        ...(hasValue && { value: entry['value'] }),
      },
    ]
  })
}

/** Notes and footers accept a single string or a list, for the same reason examples do. */
const asNotes = (value: unknown): readonly string[] => {
  const entries = Array.isArray(value) ? value : [value]
  return entries.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

/** A `x-doc` member that must be one of a fixed set, or absent. */
const asOneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined

/**
 * Reads the `x-doc` keyword off a schema node. The schema is parsed JSON rather
 * than validated input, so every member is read defensively: a mistyped
 * `x-doc.order` should leave the property in schema order, not throw halfway
 * through a docs build.
 */
export const readDocMeta = (node: unknown): DocMeta => {
  const doc = isObject(node) && isObject(node[DOC_KEY]) ? node[DOC_KEY] : {}
  const page = stringExtension(doc['page'])
  const section = stringExtension(doc['section'])
  const type = stringExtension(doc['type'])
  const title = stringExtension(doc['title'])
  const layout = asOneOf(doc['layout'], LAYOUTS)
  const sort = asOneOf(doc['sort'], SORTS)
  const order = typeof doc['order'] === 'number' && Number.isFinite(doc['order']) ? doc['order'] : undefined
  return {
    ...(page !== undefined && { page }),
    ...(section !== undefined && { section }),
    ...(type !== undefined && { type }),
    ...(title !== undefined && { title }),
    ...(layout !== undefined && { layout }),
    ...(sort !== undefined && { sort }),
    ...(order !== undefined && { order }),
    hidden: doc['hidden'] === true,
    heading: doc['heading'] !== false,
    // Both spellings are merged rather than one winning, so a schema that grows
    // a second example does not have to rewrite the first one.
    examples: [...asExamples(doc['example']), ...asExamples(doc['examples'])],
    notes: [...asNotes(doc['note']), ...asNotes(doc['notes'])],
    footers: [...asNotes(doc['footer']), ...asNotes(doc['footers'])],
  }
}

/**
 * The prose for a node: the `x-doc` override when there is one, and the schema's
 * own `description` otherwise.
 *
 * An override of `""` is honoured rather than treated as absent. A node that
 * only exists to pass a page or a section down to its children ends up printing
 * its parent's sentence a second time, and an empty override is how an author
 * says "the section above already said this".
 */
export const readDescription = (node: unknown): string => {
  const doc = isObject(node) && isObject(node[DOC_KEY]) ? node[DOC_KEY] : {}
  if (typeof doc['description'] === 'string') return doc['description']
  return asText(isObject(node) ? node['description'] : undefined)
}
