/**
 * Emits a schema-derived JSON serializer (as JavaScript source) in the
 * fast-json-stringify style: known keys concatenated positionally instead of
 * a generic `JSON.stringify` walk, with `JSON.stringify` kept only where
 * escaping matters (strings) or where a value strays from its declared type.
 *
 * Only schemas with `additionalProperties: false` qualify: an open schema
 * means the reply may legally carry keys the serializer does not know about,
 * and dropping them would diverge from what the runtime engine sends. Returns
 * `undefined` outside the subset; the emitter then falls back to
 * `JSON.stringify`, which handles everything.
 *
 * Like fast-json-stringify, the emitted code assumes the reply matches its
 * contract — a required property that is missing at runtime produces broken
 * JSON rather than a validation error. Response validation in development is
 * the net for that.
 */
export const generateSerializerSource = (schema: unknown): string | undefined => {
  if (typeof schema !== 'object' || schema === null) return undefined
  for (const key of Object.keys(schema)) {
    if (key !== 'type' && key !== 'properties' && key !== 'required' && key !== 'additionalProperties') {
      return undefined
    }
  }
  const { type, properties, required, additionalProperties } = schema as {
    type?: unknown
    properties?: unknown
    required?: unknown
    additionalProperties?: unknown
  }
  if (type !== 'object' || additionalProperties !== false) return undefined
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) return undefined
  const requiredKeys = required ?? []
  if (!Array.isArray(requiredKeys) || requiredKeys.some((key) => typeof key !== 'string')) return undefined

  const entries = Object.entries(properties)
  if (entries.some(([, property]) => pieceFor(property) === undefined)) return undefined

  // Required keys are emitted first so optional ones can always prefix a
  // comma. Key order may differ from a JSON.stringify of the same object,
  // which is cosmetic — JSON objects are unordered.
  const requiredEntries = entries.filter(([key]) => requiredKeys.includes(key))
  const optionalEntries = entries.filter(([key]) => !requiredKeys.includes(key))
  if (requiredEntries.length === 0) return undefined

  const lines: string[] = ['(body) => {']
  const opening = requiredEntries
    .map(([key, property], index) => {
      const accessor = `body[${JSON.stringify(key)}]`
      const prefix = (index === 0 ? '{' : ',') + JSON.stringify(key) + ':'
      return `${JSON.stringify(prefix)} + ${pieceFor(property)?.(accessor) ?? ''}`
    })
    .join(' + ')
  lines.push(`  let out = ${opening}`)
  for (const [key, property] of optionalEntries) {
    const accessor = `body[${JSON.stringify(key)}]`
    const prefix = ',' + JSON.stringify(key) + ':'
    lines.push(
      `  if (${accessor} !== undefined) out += ${JSON.stringify(prefix)} + ${pieceFor(property)?.(accessor) ?? ''}`,
    )
  }
  lines.push("  return out + '}'", '}')
  return lines.join('\n')
}

/**
 * The concatenation expression for one primitive property value. Numbers are
 * concatenated raw when finite (NaN/Infinity fall back to JSON.stringify,
 * which emits `null` — matching what a whole-object stringify would do), and
 * strings always go through JSON.stringify for quoting and escaping.
 */
const pieceFor = (property: unknown): ((accessor: string) => string) | undefined => {
  if (typeof property !== 'object' || property === null) return undefined
  const keys = Object.keys(property)
  if (keys.length !== 1 || keys[0] !== 'type') return undefined
  switch ((property as { type?: unknown }).type) {
    case 'string':
      return (accessor) => `JSON.stringify(${accessor})`
    case 'number':
    case 'integer':
      return (accessor) => `(Number.isFinite(${accessor}) ? ${accessor} : JSON.stringify(${accessor}))`
    case 'boolean':
      return (accessor) => `(typeof ${accessor} === 'boolean' ? ${accessor} : JSON.stringify(${accessor}))`
    default:
      return undefined
  }
}
