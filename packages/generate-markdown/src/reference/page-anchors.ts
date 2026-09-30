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
 *
 * `reserved` anchors are treated as taken from the start without being
 * claimed, for a registry whose ids share the page with anchors it does not
 * hand out itself — the step ids, which must not land on a heading's anchor.
 */
export const pageAnchors = (reserved: Iterable<string> = []): PageAnchors => {
  // Every anchor handed out, mapped to how many repeats of it have been
  // numbered — github-slugger's bookkeeping, which is what a docs site runs.
  const taken = new Map<string, number>()
  for (const anchor of reserved) taken.set(anchor, 0)
  const claimed = new Map<DocEntry, string>()
  let last:
    | {
        readonly base: string
        readonly anchor: string
        readonly repeats: number | undefined
        readonly entry: DocEntry | undefined
      }
    | undefined

  return {
    claim: (text, entry) => {
      const base = headingAnchor(text)
      // A heading of pure punctuation slugs to nothing. Counting it would be
      // counting the empty anchor a docs site gives every one of them. It is
      // still the most recent claim, so there is nothing for an undo to take
      // back — rolling back the claim before it instead handed that anchor
      // out a second time.
      if (base.length === 0) {
        last = undefined
        return ''
      }
      const repeats = taken.get(base)
      // Numbered until the result is free, not just once: a page with two
      // `deploy` headings and one titled `Deploy 1` would otherwise hand out
      // `deploy-1` twice, and a docs site gives the third `deploy-1-1`.
      let anchor = base
      while (taken.has(anchor)) {
        const next = (taken.get(base) ?? 0) + 1
        taken.set(base, next)
        anchor = `${base}-${next}`
      }
      taken.set(anchor, 0)
      if (entry !== undefined) claimed.set(entry, anchor)
      last = { base, anchor, repeats, entry }
      return anchor
    },
    undoClaim: () => {
      if (last === undefined) return
      taken.delete(last.anchor)
      if (last.anchor !== last.base && last.repeats !== undefined) taken.set(last.base, last.repeats)
      if (last.entry !== undefined) claimed.delete(last.entry)
      last = undefined
    },
    anchorOf: (entry) => claimed.get(entry),
    all: () => [...taken.keys()],
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
