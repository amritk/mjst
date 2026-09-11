import { isObject, stringExtension } from '#helpers/guards'

/**
 * One author-declared table column: the keyword each property carries its value
 * in, and the header that column renders under.
 */
export type ExtraColumn = {
  /** The property keyword this column reads, e.g. `x-scalar-stability`. */
  readonly key: string
  /** The text rendered in the header cell. */
  readonly label: string
}

/**
 * Reads the root schema's `x-extra-columns` declaration — a keyword → header
 * map — so a schema can carry its own vendor data into the table without this
 * package having to learn about every extension anyone invents:
 *
 * ```json
 * { "x-extra-columns": { "x-scalar-stability": "Stability" } }
 * ```
 *
 * Columns render in declaration order, after the built-in ones. Everything here
 * is read defensively, like the rest of the table renderer: a config schema is
 * parsed JSON rather than validated input, so a declaration that is not an
 * object, or an entry whose header is not a non-empty string, is skipped rather
 * than allowed to reach the output as a column no one can read.
 */
export const readExtraColumns = (value: unknown): readonly ExtraColumn[] => {
  if (!isObject(value)) return []
  return Object.entries(value).flatMap(([key, label]) => {
    const text = stringExtension(label)
    return text === undefined ? [] : [{ key, label: text }]
  })
}
