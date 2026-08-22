/**
 * One rendered markdown file. Mirrors the `GeneratedFile` shape the other
 * generators in this monorepo return, so a caller can write the docs the same
 * way it writes generated TypeScript.
 */
export type GeneratedFile = {
  /** Path relative to the output directory, e.g. `guides/typescript.md`. */
  readonly filename: string
  readonly content: string
}

/**
 * A fenced code block attached to a page, a section, or a property. Either the
 * `code` is written out verbatim, or a `value` is serialized in the page's
 * language — writing `{ "value": { "darkMode": true } }` in the schema beats
 * hand-escaping a JSON string, and it stays valid JSON either way.
 */
export type DocExample = {
  /** Fence language. Defaults to the page language (`x-doc.language`). */
  readonly language?: string
  /** Optional line of prose rendered above the fence. */
  readonly caption?: string
  /** Literal code. Wins over {@link DocExample.value} when both are given. */
  readonly code?: string
  /** A JSON value serialized into the fence's language. */
  readonly value?: unknown
}

/**
 * How a property's nested `properties` are documented:
 *
 * - `headings` — each child becomes its own (deeper) heading, like the main
 *   property list. Best when children need prose and examples of their own.
 * - `table` — children become one markdown table. Best for flat option bags.
 * - `none` — children are not rendered at all, which is what you want when the
 *   description already explains the shape.
 */
export type DocLayout = 'headings' | 'table' | 'none'

/** Order properties are listed in: as written in the schema, or by name. */
export type DocSort = 'schema' | 'alphabetical'

/**
 * The normalized `x-doc` keyword of a single property. Everything here is
 * documentation-only: none of it changes what the schema validates, which is
 * why it lives under one vendor extension instead of leaking into the standard
 * keywords.
 */
export type DocMeta = {
  /** Id of the page this property is documented on. Defaults to the index page. */
  readonly page?: string
  /** Id of the section this property belongs to, declared in the root `x-doc.sections`. */
  readonly section?: string
  /**
   * Overrides the **Type:** label. Real config schemas are often documented in
   * terms of a named type (`AuthenticationConfiguration`) or a function
   * signature that JSON Schema cannot express at all.
   */
  readonly type?: string
  /** Overrides the heading text, which defaults to the property name. */
  readonly title?: string
  readonly layout?: DocLayout
  /** Sort order for this property's children. */
  readonly sort?: DocSort
  /** Sorts ahead of properties with a higher (or missing) order. */
  readonly order?: number
  /** Keeps the property out of the docs entirely — internal or experimental options. */
  readonly hidden: boolean
  /**
   * `false` renders the property without its heading and without the
   * **Type:** / **Required** markers — for the property that *is* the page or
   * the section, where repeating its name and shape under the title it already
   * has reads like a stutter. Its children move up a heading level to fill the
   * gap.
   */
  readonly heading: boolean
  readonly examples: readonly DocExample[]
  /** Rendered as blockquotes under the description, above the examples. */
  readonly notes: readonly string[]
  /**
   * Markdown rendered after the examples — the "and when you pass `'direct'`…"
   * paragraph that only makes sense once the reader has seen the sample.
   */
  readonly footers: readonly string[]
}

/** A markdown file the docs are split across. */
export type DocPage = {
  /** Id properties reference through `x-doc.page`. */
  readonly id: string
  /** Output path relative to the output directory. */
  readonly file: string
  readonly title?: string
  /** Markdown rendered under the page title. */
  readonly description?: string
  readonly examples: readonly DocExample[]
}

/**
 * A `##` grouping inside a page. A section with no properties still renders —
 * that is how prose-only sections ("Minimal config", with a code example and no
 * property list) move into the schema instead of living in a hand-edited file.
 */
export type DocSection = {
  /** Id properties reference through `x-doc.section`. */
  readonly id: string
  readonly title?: string
  readonly description?: string
  /** Page this section (and every property in it) renders on. */
  readonly page: string
  readonly sort?: DocSort
  readonly examples: readonly DocExample[]
}

/**
 * Programmatic overrides for what the schema declares in its root `x-doc`. The
 * schema is the source of truth — these exist so a caller can point the same
 * schema at a different output file or language without editing it.
 *
 * Every member reads `?: T | undefined` rather than `?: T`, because this repo
 * compiles with `exactOptionalPropertyTypes` and consumers do too: a caller
 * forwarding an optional flag it may or may not have (`{ title: cliArgs.title }`)
 * is the ordinary way to use this, and the stricter spelling rejects it.
 */
export type MarkdownOptions = {
  /** Output path of the index page. Defaults to `x-doc.file`, then `index.md`. */
  readonly file?: string | undefined
  /** Page title. Defaults to the schema's `title`. */
  readonly title?: string | undefined
  /** Fence language for derived examples and literals. Defaults to `json`. */
  readonly language?: string | undefined
  /** Default layout for nested properties. Defaults to `headings`. */
  readonly layout?: DocLayout | undefined
  /** Default property order. Defaults to `schema`. */
  readonly sort?: DocSort | undefined
  /** Heading level of the page title. Defaults to `1` (`#`). */
  readonly headingLevel?: number | undefined
}

/**
 * The whole documentation setup a schema declares in its root `x-doc`, merged
 * with the caller's overrides. Built once per run and handed to the renderers,
 * so "what language are examples in" is answered in one place.
 */
export type DocConfig = {
  readonly language: string
  readonly layout: DocLayout
  readonly sort: DocSort
  /** Every page, index first. */
  readonly pages: readonly DocPage[]
  readonly sections: readonly DocSection[]
  /** Heading level of a page title. */
  readonly headingLevel: number
}
