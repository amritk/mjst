/**
 * The client runtime reads only a sliver of each contract: `method`, `path`,
 * `request.bodyType`, whether a request/response `body` schema exists, and
 * each response status's `contentType` marker. Everything else — request and
 * response schemas, `refine`, `summary`, `description`, tags, security — is
 * server/OpenAPI freight that a browser bundle pays for without ever reading.
 *
 * This transform rewrites `defineContract({ ... })` call sites to just the
 * fields the client reads, replacing `body` schemas with a `true` marker (the
 * runtime only checks `body !== undefined`). Types are compile-time, so the
 * consumer's TypeScript never notices; dropping a schema property also drops
 * the bundler's reference to any imported schema value, letting tree-shaking
 * remove it. The Vite, Rollup, esbuild, and Bun plugins in this directory
 * apply it per module.
 *
 * The scanner is deliberately conservative: any call site it cannot parse
 * with certainty (spreads, computed keys, explicit type arguments, syntax it
 * does not model) is left byte-for-byte untouched, so the failure mode is a
 * bigger bundle, never a broken one. Unknown property names are kept, not
 * dropped — a field added to `Contract` later (possibly runtime-read) must
 * survive an older plugin.
 */

/** The top-level contract fields the client never reads at runtime. */
const STRIP_TOP_LEVEL = new Set(['summary', 'description', 'tags', 'operationId', 'deprecated', 'security', 'refine'])

/** Request slots the client only echoes values into — their schemas are server freight. */
const STRIP_REQUEST = new Set(['params', 'query', 'headers', 'cookies'])

/** Response fields only OpenAPI generation and server-side validation read. */
const STRIP_RESPONSE = new Set(['description', 'headers'])

/**
 * Characters after which a `/` starts a regex literal rather than division.
 * The classic heuristic — good enough because contract literals are data, and
 * a wrong guess only makes the scanner bail (leaving the call site intact).
 */
const REGEX_PRECEDING = new Set([
  '(',
  '[',
  '{',
  ',',
  ';',
  ':',
  '=',
  '?',
  '!',
  '&',
  '|',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '^',
  '~',
])

type Span = { readonly start: number; readonly end: number }

type ObjectProperty = {
  /** Property key with any quotes stripped. */
  readonly name: string
  /** Raw source of the whole property, key through value, trailing trivia trimmed. */
  readonly raw: string
  /** Where the value expression sits (end is the delimiter after it). */
  readonly value: Span
}

type ParsedObject = {
  readonly properties: readonly ObjectProperty[]
  /** Position just past the closing brace. */
  readonly end: number
}

/** Skips whitespace and both comment forms; returns the next significant index. */
const skipTrivia = (source: string, from: number): number => {
  let index = from
  while (index < source.length) {
    const char = source[index]
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1
    } else if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
    } else if (char === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2)
      if (close === -1) return source.length
      index = close + 2
    } else {
      return index
    }
  }
  return index
}

/** From an opening quote, returns the index past the closing quote, or null. */
const scanString = (source: string, from: number): number | null => {
  const quote = source[from]
  let index = from + 1
  while (index < source.length) {
    const char = source[index]
    if (char === '\\') index += 2
    else if (char === quote) return index + 1
    else if (char === '\n') return null
    else index += 1
  }
  return null
}

/** From an opening slash, returns the index past the closing slash, or null. */
const scanRegex = (source: string, from: number): number | null => {
  let index = from + 1
  let inClass = false
  while (index < source.length) {
    const char = source[index]
    if (char === '\\') index += 2
    else if (char === '\n') return null
    else if (char === '[') {
      inClass = true
      index += 1
    } else if (char === ']') {
      inClass = false
      index += 1
    } else if (char === '/' && !inClass) {
      return index + 1
    } else index += 1
  }
  return null
}

/** From an opening backtick, returns the index past the closing one, or null. */
const scanTemplate = (source: string, from: number): number | null => {
  let index = from + 1
  while (index < source.length) {
    const char = source[index]
    if (char === '\\') {
      index += 2
    } else if (char === '`') {
      return index + 1
    } else if (char === '$' && source[index + 1] === '{') {
      // A substitution holds a full expression (commas included), so scan
      // expressions until the matching close brace.
      index += 2
      while (true) {
        const end = scanExpression(source, index)
        if (end === null) return null
        if (source[end] === '}') {
          index = end + 1
          break
        }
        index = end + 1
      }
    } else index += 1
  }
  return null
}

/**
 * Scans one expression: consumes until a `,` or `}` at nesting depth zero and
 * returns that delimiter's index, or null when the source cannot be followed
 * confidently. Handles strings, templates, comments, regex literals, and
 * bracket nesting — enough to skip over any contract property value,
 * including `refine` arrow functions.
 */
const scanExpression = (source: string, from: number): number | null => {
  let depth = 0
  let previous = ''
  let index = from
  while (index < source.length) {
    const char = source[index]
    if (char === undefined) return null
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1
    } else if (char === '/' && (source[index + 1] === '/' || source[index + 1] === '*')) {
      index = skipTrivia(source, index)
    } else if (char === "'" || char === '"') {
      const end = scanString(source, index)
      if (end === null) return null
      index = end
      previous = char
    } else if (char === '`') {
      const end = scanTemplate(source, index)
      if (end === null) return null
      index = end
      previous = char
    } else if (char === '/') {
      if (previous === '' || REGEX_PRECEDING.has(previous)) {
        const end = scanRegex(source, index)
        if (end === null) return null
        index = end
        previous = '0'
      } else {
        index += 1
        previous = char
      }
    } else if (char === '(' || char === '[' || char === '{') {
      depth += 1
      index += 1
      previous = char
    } else if (char === ')' || char === ']') {
      if (depth === 0) return null
      depth -= 1
      index += 1
      previous = char
    } else if (char === '}') {
      if (depth === 0) return index
      depth -= 1
      index += 1
      previous = char
    } else if (char === ',' && depth === 0) {
      return index
    } else {
      index += 1
      previous = char
    }
  }
  return null
}

/** Parses an object literal from its opening brace into keyed property spans, or null. */
const parseObjectLiteral = (source: string, braceIndex: number): ParsedObject | null => {
  const properties: ObjectProperty[] = []
  let index = skipTrivia(source, braceIndex + 1)
  while (true) {
    if (index >= source.length) return null
    if (source[index] === '}') return { properties, end: index + 1 }

    const keyStart = index
    const keyChar = source[index]
    let name: string
    if (keyChar === "'" || keyChar === '"') {
      const end = scanString(source, index)
      if (end === null) return null
      name = source.slice(index + 1, end - 1)
      index = end
    } else if (keyChar !== undefined && /[\w$]/.test(keyChar)) {
      let end = index
      while (end < source.length && /[\w$.]/.test(source[end] as string)) end += 1
      name = source.slice(index, end)
      index = end
    } else {
      // Spread, computed key, or anything else the rewrite cannot reason about.
      return null
    }

    index = skipTrivia(source, index)
    let value: Span
    const afterKey = source[index]
    if (afterKey === ':') {
      const start = skipTrivia(source, index + 1)
      const end = scanExpression(source, start)
      if (end === null) return null
      value = { start, end }
      index = end
    } else if (afterKey === '(') {
      // Method shorthand (`refine(input) { ... }`) — the params + body pair
      // scans like one nested expression.
      const end = scanExpression(source, index)
      if (end === null) return null
      value = { start: keyStart, end }
      index = end
    } else if (afterKey === ',' || afterKey === '}') {
      // Shorthand property referencing an outer binding.
      value = { start: keyStart, end: index }
    } else {
      return null
    }

    properties.push({ name, raw: source.slice(keyStart, value.end).trimEnd(), value })
    if (source[index] === ',') index = skipTrivia(source, index + 1)
  }
}

/**
 * Parses a property's value as an object literal covering the whole value
 * expression, or null when it is anything else (an identifier reference, a
 * cast) — in which case the caller keeps the raw source.
 */
const parseValueObject = (source: string, property: ObjectProperty): ParsedObject | null => {
  if (source[property.value.start] !== '{') return null
  const parsed = parseObjectLiteral(source, property.value.start)
  if (parsed === null) return null
  // Trailing tokens after the literal (`as const`, `satisfies X`) would be
  // silently dropped by a rewrite, so treat them as unparseable instead.
  return skipTrivia(source, parsed.end) === property.value.end ? parsed : null
}

const emitObject = (parts: readonly string[]): string => (parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`)

/**
 * The replacement for a `body` schema. The runtime only checks
 * `body !== undefined`, so a schema collapses to `body: true` — except a
 * literal `body: undefined`, which must stay `undefined` to keep meaning "no
 * body" after the strip.
 */
const bodyMarker = (source: string, field: ObjectProperty): string =>
  source.slice(field.value.start, field.value.end).trim() === 'undefined' ? field.raw : 'body: true'

const rewriteRequest = (source: string, property: ObjectProperty): string => {
  const parsed = parseValueObject(source, property)
  if (parsed === null) return property.raw
  const parts: string[] = []
  for (const field of parsed.properties) {
    if (field.name === 'body') parts.push(bodyMarker(source, field))
    else if (!STRIP_REQUEST.has(field.name)) parts.push(field.raw)
  }
  return `request: ${emitObject(parts)}`
}

const rewriteResponses = (source: string, property: ObjectProperty): string => {
  const parsed = parseValueObject(source, property)
  if (parsed === null) return property.raw
  const parts: string[] = []
  for (const status of parsed.properties) {
    const statusObject = parseValueObject(source, status)
    if (statusObject === null) {
      parts.push(status.raw)
      continue
    }
    const fields: string[] = []
    for (const field of statusObject.properties) {
      if (field.name === 'body') fields.push(bodyMarker(source, field))
      else if (!STRIP_RESPONSE.has(field.name)) fields.push(field.raw)
    }
    parts.push(`${status.name}: ${emitObject(fields)}`)
  }
  return `responses: ${emitObject(parts)}`
}

const rewriteContract = (source: string, contract: ParsedObject): string => {
  const parts: string[] = []
  for (const property of contract.properties) {
    if (property.name === 'request') parts.push(rewriteRequest(source, property))
    else if (property.name === 'responses') parts.push(rewriteResponses(source, property))
    else if (!STRIP_TOP_LEVEL.has(property.name)) parts.push(property.raw)
  }
  return emitObject(parts)
}

const countNewlines = (text: string): number => {
  let count = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') count += 1
  }
  return count
}

/**
 * Rewrites every parseable `defineContract({ ... })` call site in a module's
 * source down to the fields the client runtime reads. Pure text in, text out
 * — the Vite, Rollup, esbuild, and Bun plugins wire it into their load
 * pipelines.
 *
 * The rewrite is line-preserving: every newline the original call site
 * spanned is re-emitted as padding right after the rewritten literal, so code
 * following the call site keeps its original line numbers. The plugins return
 * `map: null` (or no map at all), and without this padding any downstream
 * sourcemap would drift by the number of collapsed lines. Columns within an
 * edited line may still shift; minifiers collapse the padding again, so
 * bundle size is unaffected.
 */
export const stripContractFields = (source: string): string => {
  let output = ''
  let copiedTo = 0
  let searchFrom = 0
  while (true) {
    const found = source.indexOf('defineContract', searchFrom)
    if (found === -1) break
    const afterName = found + 'defineContract'.length
    const before = source[found - 1]
    const after = source[afterName]
    // Only a real call of the plain identifier counts — not `x.defineContract`
    // or a longer name containing it.
    if ((before !== undefined && /[\w$.]/.test(before)) || (after !== undefined && /[\w$]/.test(after))) {
      searchFrom = afterName
      continue
    }
    const parenIndex = skipTrivia(source, afterName)
    if (source[parenIndex] !== '(') {
      searchFrom = afterName
      continue
    }
    const braceIndex = skipTrivia(source, parenIndex + 1)
    if (source[braceIndex] !== '{') {
      searchFrom = afterName
      continue
    }
    const parsed = parseObjectLiteral(source, braceIndex)
    if (parsed === null) {
      searchFrom = afterName
      continue
    }
    const rewritten = rewriteContract(source, parsed)
    // The rewritten literal keeps only fragments of the original span, so it
    // can never gain newlines — pad the difference to keep later lines put.
    const removedNewlines = countNewlines(source.slice(braceIndex, parsed.end)) - countNewlines(rewritten)
    output += source.slice(copiedTo, braceIndex) + rewritten + '\n'.repeat(Math.max(0, removedNewlines))
    copiedTo = parsed.end
    searchFrom = parsed.end
  }
  return output + source.slice(copiedTo)
}
