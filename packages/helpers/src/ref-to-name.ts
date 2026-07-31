import { refToFilename } from './ref-to-filename'

/**
 * Word boundaries inside a derived name: any run of characters TypeScript will
 * not accept inside an identifier, plus `_`, which reads as a separator in the
 * `$defs` keys we see rather than as part of a word.
 *
 * `\p{ID_Continue}` — not `[A-Za-z0-9]` — is what makes non-ASCII definitions
 * work. The ASCII-only class dropped every character of a CJK, Cyrillic, or
 * accented name, so `中文` and `日本` both fell through to the `_` fallback and
 * every non-ASCII definition in a document ended up sharing one type name.
 * TypeScript identifiers are defined in terms of ID_Start/ID_Continue, so those
 * names are perfectly legal to emit verbatim.
 */
const WORD_SEPARATOR = /[^\p{ID_Continue}]+|_+/u

/** Characters TypeScript accepts as the first character of an identifier. */
const IDENTIFIER_START = /^[\p{ID_Start}_$]/u

/**
 * Converts a filename-like string to a PascalCase TypeScript identifier,
 * appending an optional suffix.
 *
 * Word boundaries are *any* run of characters that cannot appear in a JS
 * identifier — not just `-` — so a dotted key like `io.k8s.api.core.v1.Pod`
 * becomes `IoK8sApiCoreV1Pod` instead of the invalid `Io.k8s.api.core.v1.pod`.
 * A name that does not start with an identifier character (a leading digit, say)
 * is prefixed with `_`.
 *
 * The `_` fallback for an empty result is a backstop only: `refToFilename`
 * already normalizes a name that would reduce to nothing into a `ref-<hash>`
 * form, so distinct refs stay distinct before they ever reach this function.
 *
 * @example
 * ```ts
 * kebabToPascal('server-variable') // 'ServerVariable'
 * kebabToPascal('channel') // 'Channel'
 * kebabToPascal('channel', 'Object') // 'ChannelObject'
 * kebabToPascal('io.k8s.api.core.v1.pod') // 'IoK8sApiCoreV1Pod'
 * kebabToPascal('123abc') // '_123abc'
 * kebabToPascal('中文') // '中文'
 * ```
 */
const kebabToPascal = (kebab: string, suffix: string): string => {
  const words = kebab.split(WORD_SEPARATOR)
  let pascalCase = ''
  for (const word of words) {
    if (word === undefined || word === '') continue
    // Iterate by code point, not code unit, so an astral first character
    // (e.g. a Mathematical Alphanumeric letter) is not split mid-surrogate.
    const first = [...word][0] as string
    pascalCase += first.toUpperCase() + word.slice(first.length)
  }
  if (pascalCase === '') pascalCase = '_'
  else if (!IDENTIFIER_START.test(pascalCase)) pascalCase = `_${pascalCase}`
  return pascalCase + suffix
}

/**
 * Converts a JSON Schema $ref to a type name.
 * Derives the filename via `refToFilename` then converts to PascalCase,
 * appending an optional suffix.
 *
 * Handles all ref forms: internal `#/$defs/...`, `#/definitions/...`, and URI refs.
 *
 * @param ref - The $ref string
 * @param suffix - Optional suffix appended to the PascalCase name. Defaults to
 *   `''` (no suffix). Pass e.g. `'Object'` to get `ContactObject`.
 * @returns The type name in PascalCase with the suffix applied
 *
 * @example
 * ```ts
 * refToName('#/$defs/contact') // 'Contact'
 * refToName('#/$defs/server-variable') // 'ServerVariable'
 * refToName('#/$defs/contact', 'Object') // 'ContactObject'
 * refToName('http://asyncapi.com/definitions/3.1.0/channel.json') // 'Channel'
 * ```
 */
export const refToName = (ref: string, suffix = ''): string => kebabToPascal(refToFilename(ref), suffix)
