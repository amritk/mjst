/**
 * The tag names that open a CommonMark HTML block of type 6 — one that may
 * interrupt a paragraph and runs to the next blank line.
 */
const BLOCK_TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|' +
  'fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|' +
  'menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|' +
  'track|ul'

const RAW_TAG = /^ {0,3}<(?:pre|script|style|textarea)(?:[ \t>]|$)/i
const BLOCK_TAG = new RegExp(`^ {0,3}</?(?:${BLOCK_TAGS})(?:[ \\t/>]|$)`, 'i')
const ATTRIBUTE = `\\s+[A-Za-z_:][\\w.:-]*(?:\\s*=\\s*(?:[^\\s"'=<>\`]+|'[^']*'|"[^"]*"))?`
const COMPLETE_TAG = new RegExp(
  `^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:${ATTRIBUTE})*\\s*/?>|</[A-Za-z][A-Za-z0-9-]*\\s*>)[ \\t]*$`,
)

/**
 * How an HTML block ends: on the line that satisfies `ends`, that line
 * included, or — for the kinds that run to a blank line — `'blank'`.
 */
export type HtmlBlockEnd = ((line: string) => boolean) | 'blank'

/**
 * Whether a line opens a CommonMark HTML block, and how that block ends.
 * Everything inside one is raw HTML rather than markdown, so a list written
 * inside `<!-- … -->` or `<pre>` is text the author meant to keep, not a list.
 *
 * `inParagraph` matters for the one kind that cannot interrupt a paragraph: a
 * line holding nothing but a tag of any other name (`<scalar-steps>`).
 */
export const htmlBlockStart = (line: string, inParagraph: boolean): HtmlBlockEnd | undefined => {
  if (RAW_TAG.test(line)) return (end) => /<\/(?:pre|script|style|textarea)>/i.test(end)
  if (/^ {0,3}<!--/.test(line)) return (end) => end.includes('-->')
  if (/^ {0,3}<\?/.test(line)) return (end) => end.includes('?>')
  if (/^ {0,3}<![A-Za-z]/.test(line)) return (end) => end.includes('>')
  if (/^ {0,3}<!\[CDATA\[/.test(line)) return (end) => end.includes(']]>')
  if (BLOCK_TAG.test(line)) return 'blank'
  if (!inParagraph && COMPLETE_TAG.test(line)) return 'blank'
  return undefined
}
