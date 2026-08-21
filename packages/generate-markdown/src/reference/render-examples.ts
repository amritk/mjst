import { formatLiteral } from '#helpers/format-literal'
import type { DocExample } from '#types/doc'

/**
 * A fence long enough to contain the code. CommonMark closes a fenced block at
 * the first line whose backtick run is at least as long as the opening one, so
 * an example that itself contains a fence (a docs snippet, a markdown default)
 * would otherwise end the block early and spill the rest onto the page.
 */
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
    const fenceLanguage = example.language ?? language
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
