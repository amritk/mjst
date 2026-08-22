import { escapeHtml } from '#helpers/escape-html'
import { asArray } from '#helpers/guards'

/**
 * Formats a JSON value for inline display inside an HTML table cell. Strings get
 * quoted so readers know they need quotes in their config.
 *
 * Strings go through `JSON.stringify` rather than being wrapped in literal quotes
 * so control characters are escaped: a raw newline reaching the cell would end the
 * `<table>`'s HTML block mid-row, and every tag after it renders as literal text.
 */
export const formatValue = (value: unknown): string => {
  if (value === undefined || value === null) return ''
  // `Number.isFinite` guards the one case where interpolation and
  // `JSON.stringify` disagree: 1e400 would be documented as `Infinity`, telling
  // the reader to type something their JSON parser rejects.
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
    return `<code>${value}</code>`
  }
  return `<code>${escapeHtml(JSON.stringify(value))}</code>`
}

/**
 * Renders a comma-separated list of JSON values (used for `enum` and
 * `examples`), reusing {@link formatValue} so each entry is quoted and escaped
 * the same way a default is. `null` renders as `null` instead of the blank a
 * default uses — it is a listed value in its own right, and dropping it would
 * both contradict the Type column and leave a dangling separator.
 */
export const formatList = (values: readonly unknown[] | undefined): string =>
  asArray(values)
    .map((value) => (value === null ? '<code>null</code>' : formatValue(value)))
    .join(', ')
