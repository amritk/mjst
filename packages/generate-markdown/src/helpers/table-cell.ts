import { collapseLineEndings } from '#helpers/escape-html'
import { firstParagraph } from '#helpers/first-paragraph'

/**
 * Escapes text for a GitHub-flavored markdown table cell. A row is one line and
 * its columns are split on unescaped pipes, so both a line ending and a `|` in
 * the schema's own text would silently reshape the table.
 */
export const tableCell = (value: string): string =>
  collapseLineEndings(firstParagraph(value)).replace(/\|/g, '\\|').trim()
