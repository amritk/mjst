import { toKebabCase } from '@amritk/helpers/ref-to-filename'

/**
 * Folds an arbitrary channel key or message name into a filesystem- and
 * import-safe kebab token: camelCase splits, and everything a filename cannot
 * carry — a topic's `/` separators, `{param}` braces, spaces — becomes a
 * dash. `fallback` covers the value that normalizes away entirely.
 *
 * Shared by the schema layout (`channels/<channel>/<message>/`) and the channel
 * contracts (`contracts/<channel>.ts`) so the two name the same channel the
 * same way — a reader moving between the trees should not have to translate.
 */
export const sanitizeToken = (value: string, fallback: string): string => {
  const token = toKebabCase(value)
    .replace(/[^\p{ID_Continue}.]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return token === '' ? fallback : token
}
