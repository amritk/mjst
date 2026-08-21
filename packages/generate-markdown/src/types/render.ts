import type { DocLayout, DocPage, DocSection, DocSort } from '#types/doc'
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
  /** Output path of the page being rendered — the base for cross-page links. */
  readonly file: string
  /** Page id → output path, so a property documented elsewhere can be linked. */
  readonly pageFiles: ReadonlyMap<string, string>
  /** Id of the page being rendered, so children on the same page are inlined. */
  readonly page: string
}

/** One property, resolved against its parent, ready to render. */
export type DocEntry = {
  readonly name: string
  readonly prop: SchemaProperty
  /** Path from the schema root, used to wrap derived examples in their config shape. */
  readonly path: readonly string[]
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
