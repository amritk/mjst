/**
 * Emits a straight-line boolean guard (as JavaScript source) for the schema
 * subset where inlining is a clear win: a flat object of primitive-typed
 * properties with `required`, and nothing else.
 *
 * Returns `undefined` the moment any keyword falls outside that subset — the
 * emitter then falls back to the runtime interpreter, which implements all of
 * JSON Schema. Bailing instead of approximating is what keeps the compiled and
 * runtime engines semantically identical: this generator only ever replaces
 * checks whose behavior it can reproduce exactly.
 */
export const generateGuardSource = (schema: unknown): string | undefined => {
  if (typeof schema !== 'object' || schema === null) return undefined
  for (const key of Object.keys(schema)) {
    if (key !== 'type' && key !== 'properties' && key !== 'required') return undefined
  }
  const { type, properties, required } = schema as { type?: unknown; properties?: unknown; required?: unknown }
  if (type !== 'object') return undefined
  const props = properties ?? {}
  if (typeof props !== 'object' || props === null || Array.isArray(props)) return undefined
  const requiredKeys = required ?? []
  if (!Array.isArray(requiredKeys) || requiredKeys.some((key) => typeof key !== 'string')) return undefined
  // A required key with no property schema has presence-only semantics the
  // inline form does not reproduce, so leave those to the interpreter.
  for (const key of requiredKeys) {
    if (!Object.hasOwn(props, key)) return undefined
  }

  const checks: string[] = []
  let index = 0
  for (const [key, property] of Object.entries(props)) {
    const failure = primitiveFailure(property)
    if (failure === undefined) return undefined
    const variable = 'v' + index++
    checks.push(`  const ${variable} = input[${JSON.stringify(key)}]`)
    checks.push(
      requiredKeys.includes(key)
        ? `  if (${failure(variable)}) return false`
        : `  if (${variable} !== undefined && (${failure(variable)})) return false`,
    )
  }

  return [
    '(input) => {',
    // In JSON Schema, `type: "object"` excludes arrays.
    "  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false",
    ...checks,
    '  return true',
    '}',
  ].join('\n')
}

/**
 * The failing condition for one primitive property schema, or undefined when
 * the property carries anything beyond a bare primitive `type`.
 */
const primitiveFailure = (property: unknown): ((variable: string) => string) | undefined => {
  if (typeof property !== 'object' || property === null) return undefined
  const keys = Object.keys(property)
  if (keys.length !== 1 || keys[0] !== 'type') return undefined
  switch ((property as { type?: unknown }).type) {
    case 'string':
      return (variable) => `typeof ${variable} !== 'string'`
    case 'number':
      return (variable) => `typeof ${variable} !== 'number'`
    case 'integer':
      return (variable) => `typeof ${variable} !== 'number' || !Number.isInteger(${variable})`
    case 'boolean':
      return (variable) => `typeof ${variable} !== 'boolean'`
    default:
      return undefined
  }
}
