import { codeSpan } from '#helpers/code-span'
import { collapseLineEndings } from '#helpers/escape-html'
import { firstParagraph } from '#helpers/first-paragraph'

/**
 * Escapes the pipes that would split a table row into more columns than it has,
 * and only those.
 *
 * A pipe already escaped by the author is left alone. Counting the backslashes
 * in front of it is what tells the two apart: an even run means the pipe is
 * live and needs escaping, an odd run means the author already escaped it and
 * adding another would produce a literal backslash followed by a live pipe.
 *
 * Escaping the backslashes themselves would be wrong here — a description cell
 * is parsed as inline markdown, so `\*` is how an author writes a literal
 * asterisk, and doubling that backslash turns the asterisks into emphasis and
 * shows the reader a stray `\`.
 *
 * A property named with a backslash *and* a pipe (`a\|b`) has no faithful
 * spelling in a GFM row, and neither has a fix: the row is split on `|` before
 * any inline parsing, `\|` is the only escape that split recognises, and a code
 * span processes no escapes of its own — so `\|` shows the reader `a|b`, and
 * `\\|` splits the row. Losing the backslash is the version that leaves a
 * readable table, and the property's own heading (outside any row) still
 * spells it in full.
 */
const escapePipes = (value: string): string =>
  value.replace(/(\\*)\|/g, (_match, slashes: string) => (slashes.length % 2 === 0 ? `${slashes}\\|` : `${slashes}|`))

/**
 * Escapes text for a GitHub-flavored markdown table cell. A row is one line and
 * its columns are split on unescaped pipes, so both a line ending and a live `|`
 * in the schema's own text would silently reshape the table.
 */
export const tableCell = (value: string): string => escapePipes(collapseLineEndings(firstParagraph(value))).trim()

/**
 * A value rendered as a code span inside a table cell — a property's name, its
 * type label, its default.
 *
 * The span is built by `codeSpan`, so a backtick in the value cannot close it
 * early and spill the remainder into the cell as live markdown. Pipes still
 * need escaping — the row is split into columns before any inline parsing
 * happens — but nothing else does: a code span's content is literal.
 *
 * None of these is prose, so none of them goes through {@link firstParagraph},
 * and none of them is trimmed: a name is one value however it is spelled.
 * Reading it as prose erased a property called `\tindented` from its own table,
 * because a leading tab reads as an indented code block and a row cannot hold
 * one; trimming it renamed the same property to `indented`, which the schema
 * does not declare — and left the row disagreeing with the heading the other
 * layout gives it. `codeSpan` pads the span when the value has an edge space,
 * so the whitespace survives being shown.
 */
export const tableCode = (value: string): string => codeSpan(escapePipes(collapseLineEndings(value)))
