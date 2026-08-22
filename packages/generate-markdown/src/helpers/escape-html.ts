/**
 * Collapses line endings to a single space. CommonMark counts a bare CR as a
 * line ending, and every JavaScript markdown renderer counts U+2028 and U+2029
 * as ones too — their regexes are JS regexes, where those two terminate a line
 * for `.` and for multiline `^`/`$`. One of them in a title left the page with
 * no heading, and one in a description dropped its whole table body out of the
 * table.
 *
 * Every piece of schema text needs this before it reaches the output, for two
 * different reasons: inside the `<table>` a line ending ends the HTML block
 * mid-row, and inside the `####` heading it escapes the code span and lets the
 * rest of the name open a fence, a heading, a list, or a raw HTML block.
 */
export const collapseLineEndings = (value: string): string => value.replace(/[\r\n\u2028\u2029]+/g, ' ')

/**
 * Escapes the HTML-significant characters so schema text (and CLI flags such as
 * `--schema <path>`) renders literally inside the HTML table cells, and collapses
 * the line endings that would end the surrounding `<table>` block mid-row.
 */
export const escapeHtml = (value: string): string =>
  collapseLineEndings(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
