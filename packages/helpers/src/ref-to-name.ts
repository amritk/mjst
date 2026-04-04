import { refToFilename } from './ref-to-filename'

/**
 * Converts a kebab-case filename to PascalCase with an "Object" suffix.
 *
 * @example
 * ```ts
 * kebabToPascal('server-variable') // 'ServerVariableObject'
 * kebabToPascal('channel') // 'ChannelObject'
 * ```
 */
const kebabToPascal = (kebab: string): string => {
  const words = kebab.split('-')
  let pascalCase = ''
  for (const word of words) {
    pascalCase += word.charAt(0).toUpperCase() + word.slice(1)
  }
  return pascalCase + 'Object'
}

/**
 * Converts a JSON Schema $ref to a type name.
 * Derives the filename via `refToFilename` then converts to PascalCase with
 * an "Object" suffix.
 *
 * Handles all ref forms: internal `#/$defs/...`, `#/definitions/...`, and URI refs.
 *
 * @param ref - The $ref string
 * @returns The type name in PascalCase with "Object" suffix
 *
 * @example
 * ```ts
 * refToName('#/$defs/contact') // 'ContactObject'
 * refToName('#/$defs/server-variable') // 'ServerVariableObject'
 * refToName('#/$defs/response-or-reference') // 'ResponseObject'
 * refToName('http://asyncapi.com/definitions/3.1.0/channel.json') // 'ChannelObject'
 * ```
 */
export const refToName = (ref: string): string => kebabToPascal(refToFilename(ref))
