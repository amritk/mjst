/**
 * The first paragraph of a description. Table cells hold one line, so the rest
 * of a long description belongs on the property's own heading rather than
 * squeezed into a row.
 *
 * Line endings are normalised before splitting: spelling the blank-line
 * alternation inline lets the regex engine hand a `\r` to one branch and the
 * `\n` to the other, which cuts a CRLF document off after its first line.
 */
export const firstParagraph = (value: string): string =>
  (value.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)[0] ?? '').trim()
