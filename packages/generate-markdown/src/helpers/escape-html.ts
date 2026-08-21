/**
 * Collapses line endings to a single space. CommonMark counts a bare CR as a
 * line ending, so both are collapsed rather than just `\n`.
 *
 * Every piece of schema text needs this before it reaches the output, for two
 * different reasons: inside the `<table>` a line ending ends the HTML block
 * mid-row, and inside the `####` heading it escapes the code span and lets the
 * rest of the name open a fence, a heading, a list, or a raw HTML block.
 */
export const collapseLineEndings = (value: string): string => value.replace(/[\r\n]+/g, ' ')

/**
 * Escapes the HTML-significant characters so schema text (and CLI flags such as
 * `--schema <path>`) renders literally inside the HTML table cells, and collapses
 * the line endings that would end the surrounding `<table>` block mid-row.
 */
export const escapeHtml = (value: string): string =>
  collapseLineEndings(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
