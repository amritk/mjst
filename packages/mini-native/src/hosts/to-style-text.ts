/**
 * Spells one style-bag entry the way a target's style API wants to read it.
 *
 * A bare number in a style bag means density-independent pixels — the
 * convention every native toolkit and React Native itself uses — so adding the
 * unit is the host's job, and this is the one place any host has to do it. The
 * runtime hands numbers through untouched precisely so the decision lands here.
 *
 * Nothing platform-specific may creep into this file: the core type-check pass
 * deliberately runs without the DOM library, and this is shared by the hosts
 * that check under it.
 *
 * @param key The style key, camelCase or kebab-case, as the caller wrote it.
 * @param value The entry's value. Callers drop the `null | undefined | false`
 *   arms of `StyleValue` first, since those mean "unset" rather than a value.
 *
 * @example
 * ```ts
 * toStyleText('width', 100) // '100px'
 * toStyleText('opacity', 0.5) // '0.5'
 * toStyleText('width', '50%') // '50%'
 * ```
 */
export const toStyleText = (key: string, value: string | number): string => {
  if (typeof value !== 'number') return String(value)
  // A custom property is whatever its author says it is, so guessing a unit for
  // one would be presumptuous — pass the number through and let the declaration
  // that consumes it decide.
  if (key.startsWith('--')) return String(value)
  return UNITLESS.has(normalise(key)) ? String(value) : `${value}px`
}

/**
 * The properties whose numbers are ratios, counts, or multipliers rather than
 * lengths, so a unit would break them.
 *
 * Kept short on purpose: this covers what a layout actually reaches for, and an
 * unlisted property that turns out to need it is a one-line addition. The names
 * are stored normalised so both spellings of a key match.
 */
const UNITLESS = new Set([
  'opacity',
  'zindex',
  'flex',
  'flexgrow',
  'flexshrink',
  'order',
  'lineheight',
  'fontweight',
  'zoom',
  'aspectratio',
  'scale',
])

/** Folds `zIndex` and `z-index` onto the same lookup key, since style bags accept both. */
const normalise = (key: string): string => key.replace(/-/g, '').toLowerCase()
