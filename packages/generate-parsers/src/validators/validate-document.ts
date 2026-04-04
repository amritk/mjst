import { validate } from '@scalar/openapi-parser'

/**
 * An error found during document validation.
 */
export type ValidationError = {
  message: string
  path?: string
}

/**
 * The result of validating a document.
 * Returns `true` when the document is valid, or an object with `valid: false`
 * and a list of errors when it is not.
 */
export type ValidationResult = true | { valid: false; errors: ValidationError[] }

/**
 * Validates an OpenAPI document and returns `true` if valid, or an object
 * containing the validation errors if not.
 *
 * @example
 * ```typescript
 * const result = await validateDocument({ openapi: '3.1.0', info: { title: 'My API', version: '1.0' }, paths: {} })
 * // result === true
 *
 * const result = await validateDocument({ openapi: '3.1.0', info: { version: '1.0' }, paths: {} })
 * // result === { valid: false, errors: [{ message: "must have required property 'title'", path: '/info' }] }
 * ```
 */
export const validateDocument = async (document: unknown): Promise<ValidationResult> => {
  const result = await validate(document as Record<string, unknown>)

  if (result.valid) {
    return true
  }

  return {
    valid: false,
    errors: result.errors.map((error) => ({
      message: error.message,
      ...(error.path ? { path: error.path } : {}),
    })),
  }
}
