import { refToFilename } from './ref-to-filename'

/**
 * Converts a kebab-case filename to PascalCase, appending an optional suffix.
 *
 * @example
 * ```ts
 * kebabToPascal('server-variable') // 'ServerVariable'
 * kebabToPascal('channel') // 'Channel'
 * kebabToPascal('channel', 'Object') // 'ChannelObject'
 * ```
 */
const kebabToPascal = (kebab: string, suffix: string): string => {
  const words = kebab.split('-')
  let pascalCase = ''
  for (const word of words) {
    pascalCase += word.charAt(0).toUpperCase() + word.slice(1)
  }
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
