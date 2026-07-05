/**
 * Checks whether a property name is a valid JavaScript identifier that can be
 * accessed with dot notation. Property names containing hyphens, dots, or
 * other special characters (e.g., "x-linkedin") must use bracket notation.
 */
const JS_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

/**
 * Generates a safe property accessor for a given key on an object variable.
 * Uses dot notation for simple identifiers and bracket notation for keys
 * that contain special characters like hyphens.
 *
 * @param variable - The variable name (e.g., "input", "input?")
 * @param key - The property name to access
 * @returns A valid JS property access expression
 *
 * @example
 * safeAccessor("input", "name") // "input.name"
 * safeAccessor("input?", "x-linkedin") // 'input?.["x-linkedin"]'
 * safeAccessor("input", "x-linkedin") // 'input["x-linkedin"]'
 */
export const safeAccessor = (variable: string, key: string): string => {
  if (JS_IDENTIFIER.test(key)) {
    return `${variable}.${key}`
  }

  // Bracket keys are schema-controlled, so escape via JSON.stringify — a key like
  // `it's` or `a']; evil(); //` would otherwise break or hijack the generated code.
  const literal = JSON.stringify(key)

  // Handle optional chaining: "input?" -> "input?.['key']"
  if (variable.endsWith('?')) {
    return `${variable}.[${literal}]`
  }

  return `${variable}[${literal}]`
}

/**
 * Generates a safe property key for use in object literals.
 * Wraps keys that are not valid identifiers in quotes.
 *
 * @example
 * safeKey("name") // "name"
 * safeKey("x-linkedin") // '"x-linkedin"'
 */
export const safeKey = (key: string): string => {
  if (JS_IDENTIFIER.test(key)) {
    return key
  }
  // Schema-controlled keys must be escaped; a bare-quoted `it's` produces broken TS.
  return JSON.stringify(key)
}
