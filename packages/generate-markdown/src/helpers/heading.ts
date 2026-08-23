/** Markdown's deepest heading. Anything past `######` stops being a heading. */
const MAX_HEADING_LEVEL = 6

/**
 * Builds a markdown heading, clamped to a level markdown still renders as one.
 * Nesting runs deep in real config schemas — a property four levels down on a
 * page whose title is already `##` would otherwise ask for `#######`, which
 * renders as literal hashes.
 */
export const heading = (level: number, text: string): string =>
  `${'#'.repeat(Math.max(1, Math.min(level, MAX_HEADING_LEVEL)))} ${text}`
