import { formatLiteral } from '#helpers/format-literal'
import type { DocExample } from '#types/doc'

/**
 * A fence long enough to contain the code. CommonMark closes a fenced block at
 * the first line whose backtick run is at least as long as the opening one, so
 * an example that itself contains a fence (a docs snippet, a markdown default)
 * would otherwise end the block early and spill the rest onto the page.
 */
/**
 * The language name written after the opening backticks. It comes from
 * `x-doc.language`, so it is schema text: a line ending in it closed the fence
 * on the very next line and turned the example body into page content, and a
 * backtick made the opening line not a fence at all (CommonMark forbids
 * backticks in a backtick info string), which left the sample's own `#` lines
 * rendering as real headings.
 *
 * Language names are short identifiers, so anything outside that shape is
 * dropped rather than escaped.
 */
const fenceLanguageOf = (language: string): string => (language.match(/[A-Za-z0-9_+#.-]+/) ?? [''])[0]

const fenceFor = (code: string): string => {
  const longest = (code.match(/^\s*`{3,}/gm) ?? []).reduce((max, run) => Math.max(max, run.trim().length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * Renders a property's (or page's, or section's) code examples as markdown
 * blocks. An example carries either literal `code` or a `value` that is
 * serialized into the page's language — writing the value is what lets a JSON
 * schema hold a JSON example without escaping it into a string first.
 *
 * Each caption becomes its own block above the fence, so the caller can join
 * everything with blank lines and get the spacing right.
 */
export const renderExamples = (examples: readonly DocExample[], language: string): readonly string[] =>
  examples.flatMap((example): readonly string[] => {
    const fenceLanguage = fenceLanguageOf(example.language ?? language)
    const code =
      example.code !== undefined
        ? example.code
        : Object.hasOwn(example, 'value')
          ? formatLiteral(example.value, fenceLanguage)
          : undefined
    if (code === undefined) return []
    const fence = fenceFor(code)
    const block = `${fence}${fenceLanguage}\n${code.replace(/\n+$/, '')}\n${fence}`
    return example.caption !== undefined ? [example.caption, block] : [block]
  })
