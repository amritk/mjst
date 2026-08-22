import { codeSpan } from '#helpers/code-span'
import { collapseLineEndings } from '#helpers/escape-html'

/**
 * Property names that are safe to drop into a heading as-is. Anything else —
 * a backtick, a pipe, an asterisk, a bracket, a leading `#` — would be parsed
 * as markdown and the heading would render as something other than the name.
 *
 * A trailing space is one of them: an ATX heading strips it, so a property
 * called `"trail "` was headed `trail` while its own table row spelled it in
 * full — one page naming a key two ways, neither of them checkable against the
 * schema.
 */
const PLAIN_NAME = /^[A-Za-z0-9]([A-Za-z0-9 ._$/@-]*[A-Za-z0-9._$/@-])?$/

/**
 * Renders a property name as heading text. Plain names stay plain (so the
 * generated anchor is the readable `#basename` a hand-written doc would have),
 * and anything else is wrapped in a code span, whose content markdown treats as
 * literal.
 */
export const headingText = (name: string): string => {
  const collapsed = collapseLineEndings(name)
  // A run of spaces is one space to a reader, so `a  b` in a heading and
  // `` `a  b` `` in that property's own row are the same "one page, two
  // spellings" a trailing space was.
  const plain = PLAIN_NAME.test(collapsed) && !/\s\s/.test(collapsed)
  return plain ? collapsed : codeSpan(collapsed)
}

/**
 * Renders an author's heading override — `x-doc.title`, a section title, a page
 * title. Prose, not a key: it has no row to be checked against, so it is not
 * held to a property name's spelling rules. Only its line endings are
 * collapsed, because one would end the heading and let the rest of the title
 * open a heading, a list or a fence of its own.
 */
export const headingProse = (title: string): string => collapseLineEndings(title)
