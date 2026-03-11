/**
 * Converts a JSON Schema $ref to a type name.
 * Extracts the last segment of the ref path and converts it to PascalCase.
 * Handles "-or-reference" suffix by removing it.
 * Appends "Object" suffix to the resulting type name.
 *
 * @param ref - The $ref string (e.g., "#/$defs/contact" or "#/$defs/server-variable")
 * @returns The type name in PascalCase with "Object" suffix (e.g., "ContactObject" or "ServerVariableObject")
 *
 * @example
 * ```ts
 * refToName('#/$defs/contact') // 'ContactObject'
 * refToName('#/$defs/server-variable') // 'ServerVariableObject'
 * refToName('#/$defs/external-documentation') // 'ExternalDocumentationObject'
 * refToName('#/$defs/response-or-reference') // 'ResponseObject'
 * refToName('#/$defs/callbacks-or-reference') // 'CallbacksObject'
 * ```
 */
export const refToName = (ref: string): string => {
  // Extract the last segment after the last /
  const segments = ref.split('/')
  let lastSegment = segments[segments.length - 1]

  // Handle "-or-reference" suffix by stripping it
  if (lastSegment?.endsWith('-or-reference')) {
    lastSegment = lastSegment.slice(0, -13) // Remove "-or-reference" (13 characters)
  }

  // Convert kebab-case to PascalCase using a for loop instead of .split().map().join()
  const words = lastSegment?.split('-')
  let pascalCase = ''
  if (words) {
    for (const word of words) {
      pascalCase += word.charAt(0).toUpperCase() + word.slice(1)
    }
  }

  return pascalCase + 'Object'
}
