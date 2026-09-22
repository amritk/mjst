import { heading } from '#helpers/heading'
import { headingAnchor } from '#helpers/heading-anchor'
import type { RenderedHeading } from '#helpers/heading-text'
import type { DocEntry, PageAnchors, RenderContext } from '#types/render'

/**
 * The anchors of one page, handed out in the order its headings are rendered.
 *
 * Numbering repeats is the whole reason this is stateful. A page can easily
 * carry two `name` headings — a top-level `name` option, and the `name` of a
 * pagination scheme four levels down — and a docs site tells them apart by
 * numbering the later ones `name-1`, `name-2`. A row that linked to `#name`
 * without knowing which occurrence it meant would send every reader to the
 * first one, which is a link to the wrong section of the right page: worse than
 * no link, because nothing about it looks broken.
 *
 * One page's registry never touches the next, for the same reason the rest of
 * the render context is threaded rather than read from module state.
 */
export const pageAnchors = (): PageAnchors => {
  const taken = new Map<string, number>()
  const claimed = new Map<DocEntry, string>()
  let last: { readonly base: string; readonly entry: DocEntry | undefined } | undefined

  return {
    claim: (text, entry) => {
      const base = headingAnchor(text)
      // A heading of pure punctuation slugs to nothing. Counting it would be
      // counting the empty anchor a docs site gives every one of them.
      if (base.length === 0) return ''
      const seen = taken.get(base) ?? 0
      taken.set(base, seen + 1)
      const anchor = seen === 0 ? base : `${base}-${seen}`
      if (entry !== undefined) claimed.set(entry, anchor)
      last = { base, entry }
      return anchor
    },
    undoClaim: () => {
      if (last === undefined) return
      const seen = taken.get(last.base) ?? 0
      if (seen > 0) taken.set(last.base, seen - 1)
      if (last.entry !== undefined) claimed.delete(last.entry)
      last = undefined
    },
    anchorOf: (entry) => claimed.get(entry),
  }
}

/**
 * Renders a heading and claims its anchor in the same breath, so the page's
 * numbering follows the headings it actually prints and a row can be told where
 * the property below it ended up.
 *
 * Every heading on a page goes through here — the page title and the section
 * titles as much as the properties — because a docs site numbers repeats across
 * all of them, and a registry that saw only some would number the rest wrong.
 */
export const renderHeading = (
  level: number,
  rendered: RenderedHeading,
  context: RenderContext,
  entry?: DocEntry,
): string => {
  // The anchor comes from the text the heading renders as, never from its
  // markdown: the backticks around a name that needs a code span are markup,
  // and a docs site slugs what the reader is left with.
  context.anchors.claim(rendered.text, entry)
  return heading(level, rendered.markdown)
}
