/**
 * Wraps text in a markdown code span that cannot be escaped from.
 *
 * A fixed single-backtick delimiter is not enough: a backtick *in the text*
 * closes the span, and the remainder lands in ordinary inline context where raw
 * HTML, links and emphasis are all live. CommonMark's rule is that a span is
 * delimited by a backtick run longer than any run inside it, and that one
 * leading and trailing space is stripped — so pad when the text would otherwise
 * begin or end with a backtick, or when its own edge spaces need preserving.
 */
export const codeSpan = (text: string): string => {
  const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0)
  const fence = '`'.repeat(longest + 1)
  // The strip only fires when the content is not entirely spaces, so padding an
  // all-spaces name just makes it two spaces wider.
  const needsPad = text === '' || (/^[`\s]|[`\s]$/.test(text) && !/^ *$/.test(text))
  const pad = needsPad ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}
