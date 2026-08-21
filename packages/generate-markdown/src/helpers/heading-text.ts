import { codeSpan } from '#helpers/code-span'
import { collapseLineEndings } from '#helpers/escape-html'

/**
 * Property names that are safe to drop into a heading as-is. Anything else —
 * a backtick, a pipe, an asterisk, a bracket, a leading `#` — would be parsed
 * as markdown and the heading would render as something other than the name.
 */
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._$/@-]*$/

/**
 * Renders a property name as heading text. Plain names stay plain (so the
 * generated anchor is the readable `#basename` a hand-written doc would have),
 * and anything else is wrapped in a code span, whose content markdown treats as
 * literal.
 */
export const headingText = (name: string): string => {
  const collapsed = collapseLineEndings(name)
  return PLAIN_NAME.test(collapsed) ? collapsed : codeSpan(collapsed)
}
