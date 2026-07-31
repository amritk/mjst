/**
 * Checks whether a property name is a valid JavaScript identifier that can be
 * accessed with dot notation. Property names containing hyphens, dots, or
 * other special characters (e.g., "x-linkedin") must use bracket notation.
 */
const JS_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

/**
 * Every name an ordinary object inherits from `Object.prototype`
 * (`constructor`, `toString`, `valueOf`, `hasOwnProperty`, `__proto__`, …).
 *
 * Reading one of these — with a dot *or* a bracket, both walk the prototype
 * chain — never reports "absent", so a generated `input.constructor ===
 * undefined` presence check can never pass and a schema with a `constructor`
 * property makes `validateFooShape` return false for every valid object.
 * Worse, `input.__proto__` hands back `Object.prototype`, which the parser then
 * copies into its result as a key the input never had. An own-property guard is
 * the only read form that tells the two apart, so these keys get one.
 *
 * The write side already knows this class: `generate-enum-check` looks folded
 * enum members up in a `Map`, and `safeLiteralKey` emits `{ ["__proto__"]: v }`
 * so the key becomes a real own property instead of a prototype assignment.
 */
const PROTOTYPE_MEMBERS = new Set(Object.getOwnPropertyNames(Object.prototype))

/**
 * Generates a safe property accessor for a given key on an object variable.
 * Uses dot notation for simple identifiers and bracket notation for keys
 * that contain special characters like hyphens. Keys that collide with an
 * `Object.prototype` member get an own-property guard (see
 * {@link PROTOTYPE_MEMBERS}) so an inherited value never masquerades as input.
 *
 * @param variable - The variable name (e.g., "input", "input?")
 * @param key - The property name to access
 * @returns A valid JS property access expression
 *
 * @example
 * safeAccessor("input", "name") // "input.name"
 * safeAccessor("input?", "x-linkedin") // 'input?.["x-linkedin"]'
 * safeAccessor("input", "x-linkedin") // 'input["x-linkedin"]'
 * safeAccessor("input", "constructor")
 * // '(input != null && Object.hasOwn(input, "constructor") ? input["constructor"] : undefined)'
 */
export const safeAccessor = (variable: string, key: string): string => {
  if (PROTOTYPE_MEMBERS.has(key)) {
    // The optional-chaining marker is dropped: the `!= null` test already covers
    // the nullish case the `?.` was there for, and `Object.hasOwn` throws on
    // null/undefined so it has to be short-circuited either way.
    const base = variable.endsWith('?') ? variable.slice(0, -1) : variable
    const literal = JSON.stringify(key)
    return `(${base} != null && Object.hasOwn(${base}, ${literal}) ? ${base}[${literal}] : undefined)`
  }

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
