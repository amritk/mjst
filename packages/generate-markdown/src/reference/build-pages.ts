import { MAX_SCHEMA_DEPTH } from '#helpers/dereference'
import { asArray, asProperties, asSchema } from '#helpers/guards'
import { readDocMeta } from '#helpers/read-doc-meta'
import { childEntries, formatPath, sortEntries } from '#reference/child-entries'
import { INDEX_PAGE_ID } from '#reference/read-doc-config'
import type { DocConfig, DocSection } from '#types/doc'
import type { DocEntry, PageModel, SectionModel } from '#types/render'
import type { ConfigSchema } from '#types/schema'

/**
 * How deep the page scan follows nested properties — the same bound
 * `dereference` puts on the document it walks, so a schema that made it through
 * inlining is never cut short here. A lower cap silently dropped the page and
 * section assignments below it, which is the one failure a docs generator must
 * not have: the output looks complete.
 */
const MAX_SCAN_DEPTH = MAX_SCHEMA_DEPTH

/** Where one property ends up: which page, and which section of it. */
type Placement = { readonly page: string; readonly section: DocSection | undefined }

/**
 * Works out which page and section a property belongs to, and says so loudly
 * when the schema contradicts itself. A typo in `x-doc.page` would otherwise
 * drop the property out of the docs entirely — the one failure mode a docs
 * generator must never have, because nothing about the output looks wrong.
 */
const placeEntry = (entry: DocEntry, parentPage: string, sections: ReadonlyMap<string, DocSection>): Placement => {
  const meta = readDocMeta(entry.prop)
  const section = meta.section === undefined ? undefined : sections.get(meta.section)
  if (meta.section !== undefined && section === undefined) {
    throw new Error(
      `Property "${formatPath(entry.path)}" names the section "${meta.section}", which the schema's ` +
        'root `x-doc.sections` does not declare.',
    )
  }
  if (meta.page !== undefined && section !== undefined && section.page !== meta.page) {
    throw new Error(
      `Property "${formatPath(entry.path)}" is assigned to page "${meta.page}" but its section ` +
        `"${section.id}" renders on page "${section.page}". Move the section or drop the page.`,
    )
  }
  return { page: meta.page ?? section?.page ?? parentPage, section }
}

/**
 * Collects every property that starts a page — the root properties, plus any
 * nested property that names a different page than the one its parent renders
 * on. That second case is what lets a schema split `targets.typescript` into
 * its own file while the rest of `targets` stays on the index.
 */
const collectEntries = (
  entries: readonly DocEntry[],
  parentPage: string,
  isRoot: boolean,
  config: DocConfig,
  sections: ReadonlyMap<string, DocSection>,
  known: ReadonlySet<string>,
  depth: number,
  collected: Map<string, { readonly entry: DocEntry; readonly placement: Placement }[]>,
): void => {
  if (depth > MAX_SCAN_DEPTH) {
    // Returning quietly would drop every page and section assignment below this
    // point — the silent omission the placement errors exist to prevent, and
    // the one failure mode where nothing about the output looks wrong.
    throw new Error(
      `Scanning the schema for page assignments passed ${MAX_SCAN_DEPTH} levels of nesting at ` +
        `"${formatPath(entries[0]?.path ?? [])}". Flatten the schema, or move the deeply nested properties ` +
        'onto a page of their own.',
    )
  }
  for (const entry of entries) {
    const placement = placeEntry(entry, parentPage, sections)
    if (!known.has(placement.page)) {
      throw new Error(
        `Property "${formatPath(entry.path)}" is assigned to page "${placement.page}", which the schema's ` +
          'root `x-doc.pages` does not declare.',
      )
    }
    // A nested property that names a section is pulled up next to the page's own
    // properties: the section is where it is documented, and a section is a
    // page-level grouping rather than something nested inside a table.
    if (isRoot || placement.page !== parentPage || placement.section !== undefined) {
      const bucket = collected.get(placement.page) ?? []
      bucket.push({ entry, placement })
      collected.set(placement.page, bucket)
    }
    const meta = readDocMeta(entry.prop)
    // `none` means the description covers the shape, so there is nothing below
    // to document — but a child could still claim a page, so keep scanning.
    collectEntries(
      childEntries(entry.prop, entry.path, meta.sort ?? config.sort),
      placement.page,
      false,
      config,
      sections,
      known,
      depth + 1,
      collected,
    )
  }
}

/**
 * Turns a dereferenced schema into the pages that will be written: what goes on
 * each file, under which section, in what order.
 */
export const buildPages = (schema: ConfigSchema, config: DocConfig): readonly PageModel[] => {
  const sections = new Map(config.sections.map((section) => [section.id, section]))
  const known = new Set(config.pages.map((page) => page.id))
  // A page has to name a file that lives under the output directory. A path
  // that climbs out — even one that climbs back in, `../out/a.md` — is a second
  // spelling of somewhere else's file, and the duplicate check below compares
  // spellings: two pages collided on disk and the first was overwritten with no
  // error at all. An empty path is the same problem in the other direction; it
  // resolved to the output directory itself and failed as a bare EISDIR.
  const escaping = config.pages.find((page) => page.file.startsWith('..') || page.file.startsWith('/'))
  if (escaping !== undefined) {
    throw new Error(
      `The page "${escaping.id}" is written to "${escaping.file}", which is outside the output directory. ` +
        'Give it a path relative to that directory.',
    )
  }
  const nameless = config.pages.find((page) => page.file.length === 0)
  if (nameless !== undefined) {
    throw new Error(`The page "${nameless.id}" has no file to be written to. Give it a path ending in a file name.`)
  }
  const duplicateId = config.pages.find(
    (page, index) => config.pages.findIndex((other) => other.id === page.id) !== index,
  )
  if (duplicateId !== undefined) {
    throw new Error(
      `Two pages share the id "${duplicateId.id}". A property naming it would be documented in full in both ` +
        'files, so give each page in `x-doc.pages` its own id.',
    )
  }
  // Compared after normalisation, so `a.md` and `./a.md` are recognised as the
  // one file they are — otherwise the second page silently overwrote the first.
  const duplicateFile = config.pages.find(
    (page, index) => config.pages.findIndex((other) => other.file === page.file) !== index,
  )
  if (duplicateFile !== undefined) {
    throw new Error(
      `Two pages are both written to "${duplicateFile.file}". Give each page in \`x-doc.pages\` its own file.`,
    )
  }
  // Two sections with one id both claim every property naming it, so each is
  // documented twice — the same reason two pages may not share an id.
  const duplicateSection = config.sections.find(
    (section, index) => config.sections.findIndex((other) => other.id === section.id) !== index,
  )
  if (duplicateSection !== undefined) {
    throw new Error(
      `Two sections share the id "${duplicateSection.id}". Every property naming it would be documented in both, ` +
        'so give each section in `x-doc.sections` its own id.',
    )
  }
  for (const section of config.sections) {
    if (!known.has(section.page)) {
      throw new Error(
        `Section "${section.id}" renders on page "${section.page}", which the schema's root ` +
          '`x-doc.pages` does not declare.',
      )
    }
  }

  const required = new Set(asArray(schema.required))
  const rootEntries: readonly DocEntry[] = Object.entries(asProperties(schema.properties))
    .map(([name, prop]) => ({ name, prop: asSchema(prop), path: [name], required: required.has(name) }))
    .filter(({ prop }) => !readDocMeta(prop).hidden)

  const collected = new Map<string, { readonly entry: DocEntry; readonly placement: Placement }[]>()
  collectEntries(sortEntries(rootEntries, config.sort), INDEX_PAGE_ID, true, config, sections, known, 0, collected)

  return config.pages.map((page): PageModel => {
    const placed = collected.get(page.id) ?? []
    const sectionModels: readonly SectionModel[] = config.sections
      .filter((section) => section.page === page.id)
      .map((section) => ({
        section,
        entries: sortEntries(
          placed.filter(({ placement }) => placement.section?.id === section.id).map(({ entry }) => entry),
          section.sort ?? config.sort,
        ),
      }))
    return {
      page,
      entries: sortEntries(
        placed.filter(({ placement }) => placement.section === undefined).map(({ entry }) => entry),
        config.sort,
      ),
      sections: sectionModels,
    }
  })
}
