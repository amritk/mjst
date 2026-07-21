import { validate } from '@amritk/runtime-validators'

/** A map from field name to its current error message. Absent keys are valid. */
export type FormErrors = Record<string, string>

/**
 * Compiles a JSON Schema into the same `(values) => errors` function a form's
 * hand-written validator has, so both validation styles feed one code path.
 *
 * Validation runs through `@amritk/runtime-validators` — the eval-free
 * interpreter the rest of mjst uses — so forms dogfood the project's own
 * validation stack and stay CSP-safe (no `new Function`, works under a strict
 * Content-Security-Policy). Only the first error per field is surfaced; a form
 * shows one message per input.
 */
export const schemaToValidator = (schema: object): ((values: Record<string, unknown>) => FormErrors) => {
  const run = validate(schema)
  return (values) => {
    const result = run(values)
    if (result === true) return {}
    const errors: FormErrors = {}
    for (const { message, path } of result.errors) {
      const field = fieldFromError(path, message)
      // Keep the first error per field — inputs display a single message.
      if (field && !(field in errors)) errors[field] = message
    }
    return errors
  }
}

/**
 * Works out which field an error belongs to. A value-level error carries a JSON
 * Pointer path like `/email`, so the field is its first segment. A missing
 * required property is reported at the parent (an empty path) with the name
 * only in the message, so we recover it from there.
 */
const fieldFromError = (path: string, message: string): string | null => {
  if (path) return path.replace(/^\//, '').split('/')[0] ?? null
  const required = message.match(/required property '([^']+)'/)
  return required ? (required[1] ?? null) : null
}
