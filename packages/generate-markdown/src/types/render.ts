import type { DocHeadings, DocLayout, DocPage, DocSection, DocSort, DocTable } from '#types/doc'
import type { SchemaProperty } from '#types/schema'

/**
 * Everything a property needs to know about the page it is being rendered
 * into. Threaded through the renderers rather than read from module state, so
 * rendering one page can never leak into the next.
 */
export type RenderContext = {
  /** Fence language for derived examples, and the dialect literals are written in. */
  readonly language: string
  /** Default layout for nested properties, unless a property overrides it. */
  readonly layout: DocLayout
  readonly sort: DocSort
  /** How every property table on this page lays its columns and rows out. */
  readonly table: DocTable
  /** How every property heading on this page is laid out. */
  readonly headings: DocHeadings
  /** Output path of the page being rendered — the base for cross-page links. */
  readonly file: string
  /** Page id → output path, so a property documented elsewhere can be linked. */
  readonly pageFiles: ReadonlyMap<string, string>
  /** Id of the page being rendered, so children on the same page are inlined. */
  readonly page: string
  /**
   * Section id → the section, so a row can link a property its section
   * relocated — and can tell whether the section lays its properties out as
   * headings, which is what decides whether there is an anchor to link to.
   */
  readonly sections: ReadonlyMap<string, DocSection>
  /** The anchors this page has handed out, so a row can link to one of them. */
  readonly anchors: PageAnchors
}

/**
 * The anchors of one page, in the order its headings render. Mutable on
 * purpose: which anchor a heading gets depends on how many headings above it
 * already took the same one, which is only knowable as the page is built.
 */
export type PageAnchors = {
  /**
   * Claims the anchor for a heading being rendered, from the text that heading
   * renders as, and returns it. A repeat is numbered `-1`, `-2` … the way
   * GitHub numbers one, and a property named alongside it remembers the anchor
   * its own heading got.
   */
  readonly claim: (text: string, entry?: DocEntry) => string
  /**
   * Gives back the claim just made, for the one heading a page renders on
   * approval: a summarised block that turns out to hold nothing but its own
   * heading is never printed, and a claim left behind for it would number every
   * later repeat of that name one too high — and leave a row linking to an
   * anchor no heading on the page answers.
   *
   * Only the most recent claim can be given back, which is all this needs: such
   * a block renders no other heading, because a block with anything under it is
   * a block worth printing.
   */
  readonly undoClaim: () => void
  /** The anchor a property's own heading claimed, for the row that links to it. */
  readonly anchorOf: (entry: DocEntry) => string | undefined
}

/**
 * One step of a property's path from the schema root. A string is a property
 * name; the symbols are the array and map hops, which have no name of their own
 * but still have to be in the path for a derived example to come out in the
 * shape of the config file; a number is a tuple position, which has to be in it
 * for the same reason and has to say *which* position.
 */
export type PathSegment = string | number | symbol

/** One property, resolved against its parent, ready to render. */
export type DocEntry = {
  readonly name: string
  readonly prop: SchemaProperty
  /** Path from the schema root, used to wrap derived examples in their config shape. */
  readonly path: readonly PathSegment[]
  readonly required: boolean
}

/** A page and the content assigned to it, in render order. */
export type PageModel = {
  readonly page: DocPage
  /** Properties that belong to the page itself rather than one of its sections. */
  readonly entries: readonly DocEntry[]
  readonly sections: readonly SectionModel[]
}

/** A `##` grouping and the properties assigned to it. */
export type SectionModel = {
  readonly section: DocSection
  readonly entries: readonly DocEntry[]
}
