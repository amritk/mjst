/**
 * Escapes a JSON Schema `pattern` so it can be embedded between the slashes of
 * a generated regex literal (`/…/`).
 *
 * A `pattern` is an ECMA-262 regex *body*, and the generated text goes into a
 * regex literal — not a string literal — so backslashes are regex syntax and
 * must be left exactly as-is (doubling `\d` to `\\d` would change it from "a
 * digit" to "a literal backslash followed by d"). The only character that would
 * corrupt the surrounding literal is an *unescaped* `/`, which would close it
 * early. So we escape bare slashes to `\/` while leaving every existing escape
 * sequence (including an already-escaped `\/`) untouched.
 *
 * @example
 * escapeRegexPattern('\\d{4}/\\d{2}') // → '\\d{4}\\/\\d{2}'  (i.e. \d{4}\/\d{2})
 */
export const escapeRegexPattern = (pattern: string): string =>
  // Match either an escape sequence (`\` + any char, kept verbatim) or a bare
  // `/` (escaped). Consuming escape pairs first means the slash in `\/` is never
  // seen as bare, so it is not double-escaped.
  pattern.replace(/\\[\s\S]|\//g, (match) => (match === '/' ? '\\/' : match))
