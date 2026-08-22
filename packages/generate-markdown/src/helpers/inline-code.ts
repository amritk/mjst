import { codeSpan } from '#helpers/code-span'
import { collapseLineEndings } from '#helpers/escape-html'

/**
 * Renders schema-controlled text as a code span on a single line — the form
 * every `**Type:**`, `**Default:**`, `**Allowed values:**`, `**Examples:**` and
 * `**Constraints:**` label needs.
 *
 * Both halves matter, and both come from the same place: the schema is parsed
 * JSON, so any of these values can hold a backtick or a line ending. A fixed
 * single-backtick wrapper is closed by the first backtick *in the value*, which
 * drops the rest of it into live inline context — a `[link](…)` in a default
 * became a real link, and `**bold**` became bold. A line ending ends the
 * paragraph, so the span never forms at all and the label is followed by
 * whatever the rest of the value happened to spell, heading markers included.
 */
export const inlineCode = (value: string): string => codeSpan(collapseLineEndings(value))
