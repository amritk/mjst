/**
 * A single validation error with a human-readable message and a JSON Pointer
 * path indicating where in the document the error occurred.
 */
export type ValidationError = {
  message: string
  path: string
}

/**
 * The result of a generated validator function.
 * Returns `true` when the input is valid, or an object with `valid: false`
 * and a list of errors when it is not.
 */
export type ValidationResult = true | { valid: false; errors: ValidationError[] }
