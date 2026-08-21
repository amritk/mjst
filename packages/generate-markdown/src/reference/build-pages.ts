import { asArray, asProperties, asSchema } from '#helpers/guards'
import { readDocMeta } from '#helpers/read-doc-meta'
import { childEntries, sortEntries } from '#reference/child-entries'
import { INDEX_PAGE_ID } from '#reference/read-doc-config'
import type { DocConfig, DocSection } from '#types/doc'
import type { DocEntry, PageModel, SectionModel } from '#types/render'
import type { ConfigSchema } from '#types/schema'

/**
 * How deep the page scan follows nested properties. The document it walks has
 * already been dereferenced (so it is a finite tree), but a deeply nested
 * config has nothing left to say about page assignment this far down, and the
 * cap keeps a pathological schema from turning a docs build into a hang.
 */
const MAX_SCAN_DEPTH = 24

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
      `Property "${entry.path.join('.')}" names the section "${meta.section}", which the schema's ` +
        'root `x-doc.sections` does not declare.',
    )
  }
  if (meta.page !== undefined && section !== undefined && section.page !== meta.page) {
    throw new Error(
      `Property "${entry.path.join('.')}" is assigned to page "${meta.page}" but its section ` +
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
  if (depth > MAX_SCAN_DEPTH) return
  for (const entry of entries) {
    const placement = placeEntry(entry, parentPage, sections)
    if (!known.has(placement.page)) {
      throw new Error(
        `Property "${entry.path.join('.')}" is assigned to page "${placement.page}", which the schema's ` +
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
  const duplicateFile = config.pages.find(
    (page, index) => config.pages.findIndex((other) => other.file === page.file) !== index,
  )
  if (duplicateFile !== undefined) {
    throw new Error(
      `Two pages are both written to "${duplicateFile.file}". Give each page in \`x-doc.pages\` its own file.`,
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
