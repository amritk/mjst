import { asArray, asText, isObject, stringExtension } from '#helpers/guards'
import { normalizeDocPath } from '#helpers/normalize-doc-path'
import { asExamples, DOC_KEY, readDescription } from '#helpers/read-doc-meta'
import type { DocConfig, DocLayout, DocPage, DocSection, DocSort, MarkdownOptions } from '#types/doc'
import type { ConfigSchema } from '#types/schema'

/** Id of the page a property lands on when it does not name one. */
export const INDEX_PAGE_ID = 'index'

/** Where the index page goes when neither the schema nor the caller says. */
const DEFAULT_INDEX_FILE = 'index.md'

/**
 * JSON is the default example language because a `config.schema.json` most
 * often documents a JSON config file. A schema whose config is written in
 * JavaScript says so once, in `x-doc.language`.
 */
const DEFAULT_LANGUAGE = 'json'

const LAYOUTS: readonly DocLayout[] = ['headings', 'table', 'none']
const SORTS: readonly DocSort[] = ['schema', 'alphabetical']

const asOneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined

/** The root `x-doc` object, or an empty one. */
const rootDoc = (schema: ConfigSchema): Readonly<Record<string, unknown>> => {
  const doc = (schema as Readonly<Record<string, unknown>>)[DOC_KEY]
  return isObject(doc) ? doc : {}
}

/**
 * Reads the extra pages the schema declares. Every page needs an `id` (what
 * properties reference) and a `file` (where it is written); a page missing
 * either cannot be linked or written, so it is skipped rather than guessed at.
 */
const readPages = (value: unknown): readonly DocPage[] =>
  asArray(value as readonly unknown[] | undefined).flatMap((entry): readonly DocPage[] => {
    if (!isObject(entry)) return []
    const id = stringExtension(entry['id'])
    const file = stringExtension(entry['file'])
    if (id === undefined || file === undefined) return []
    const title = stringExtension(entry['title'])
    const description = asText(entry['description'])
    return [
      {
        id,
        file: normalizeDocPath(file),
        ...(title !== undefined && { title }),
        ...(description.length > 0 && { description }),
        examples: [...asExamples(entry['example']), ...asExamples(entry['examples'])],
      },
    ]
  })

/** Reads the `##` sections the schema declares, in the order it declares them. */
const readSections = (value: unknown): readonly DocSection[] =>
  asArray(value as readonly unknown[] | undefined).flatMap((entry): readonly DocSection[] => {
    if (!isObject(entry)) return []
    const id = stringExtension(entry['id'])
    if (id === undefined) return []
    const title = stringExtension(entry['title'])
    const description = asText(entry['description'])
    const sort = asOneOf(entry['sort'], SORTS)
    return [
      {
        id,
        ...(title !== undefined && { title }),
        ...(description.length > 0 && { description }),
        page: stringExtension(entry['page']) ?? INDEX_PAGE_ID,
        ...(sort !== undefined && { sort }),
        examples: [...asExamples(entry['example']), ...asExamples(entry['examples'])],
      },
    ]
  })

/**
 * Merges what the schema declares with what the caller passed. The schema wins
 * on content and the caller wins on placement: a build that wants the same
 * schema written to a different file should not have to edit the schema.
 *
 * The index page is always first and always exists, even when the schema
 * declares no pages at all — that is the single-file case, which is most of
 * them.
 */
export const readDocConfig = (schema: ConfigSchema, options: MarkdownOptions = {}): DocConfig => {
  const doc = rootDoc(schema)
  const declared = readPages(doc['pages'])
  // A schema may declare the index page explicitly (to give it examples of its
  // own); that declaration is merged rather than duplicated into a second page.
  const declaredIndex = declared.find((page) => page.id === INDEX_PAGE_ID)
  const title = options.title ?? declaredIndex?.title ?? stringExtension(doc['title']) ?? schema.title
  const description = declaredIndex?.description ?? readDescription(schema)
  const file = normalizeDocPath(
    options.file ?? declaredIndex?.file ?? stringExtension(doc['file']) ?? DEFAULT_INDEX_FILE,
  )
  const index: DocPage = {
    id: INDEX_PAGE_ID,
    file,
    ...(title !== undefined && { title }),
    ...(description.length > 0 && { description }),
    // Merged, not replaced: declaring the index page (to give it a file or a
    // title) must not silently discard the examples the root already carried.
    examples: [...asExamples(doc['example']), ...asExamples(doc['examples']), ...(declaredIndex?.examples ?? [])],
  }

  const headingLevel = typeof options.headingLevel === 'number' ? options.headingLevel : 1
  return {
    language: options.language ?? stringExtension(doc['language']) ?? DEFAULT_LANGUAGE,
    layout: options.layout ?? asOneOf(doc['layout'], LAYOUTS) ?? 'headings',
    sort: options.sort ?? asOneOf(doc['sort'], SORTS) ?? 'schema',
    pages: [index, ...declared.filter((page) => page.id !== INDEX_PAGE_ID)],
    sections: readSections(doc['sections']),
    headingLevel: Number.isFinite(headingLevel) ? Math.max(1, Math.trunc(headingLevel)) : 1,
  }
}
