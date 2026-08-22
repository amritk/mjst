import { codeSpan } from '#helpers/code-span'
import { collapseLineEndings } from '#helpers/escape-html'
import { firstParagraph } from '#helpers/first-paragraph'

/**
 * Escapes text for a GitHub-flavored markdown table cell. A row is one line and
 * its columns are split on unescaped pipes, so both a line ending and a `|` in
 * the schema's own text would silently reshape the table.
 *
 * Backslashes are escaped before pipes, and that order is the whole point: a
 * schema that already writes `\|` (how an author spells a literal pipe in prose
 * — describing an `'a' \| 'b'` union, say) turned into `\\|`, which is an
 * escaped backslash followed by a *live* column separator. The row grew a
 * column, and everything after the pipe fell off the end of the table.
 */
export const tableCell = (value: string): string =>
  collapseLineEndings(firstParagraph(value)).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').trim()

/**
 * A value rendered as a code span inside a table cell.
 *
 * Unlike {@link tableCell} this leaves backslashes alone — a code span's
 * content is literal, so escaping them would show the escapes — but pipes still
 * need it, because the row is split into columns before any inline parsing
 * happens. The span itself is built by `codeSpan`, so a backtick in the value
 * cannot close it early and spill the remainder into the cell as live markdown.
 */
export const tableCode = (value: string): string =>
  codeSpan(collapseLineEndings(firstParagraph(value)).trim().replace(/\|/g, '\\|'))
