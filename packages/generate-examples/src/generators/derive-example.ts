import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import {
  hasAdditionalProperties,
  hasAllOf,
  hasAnyOf,
  hasConst,
  hasDefault,
  hasEnum,
  hasExamples,
  hasExclusiveMaximum,
  hasExclusiveMinimum,
  hasFormat,
  hasItems,
  hasMaxItems,
  hasMaximum,
  hasMaxLength,
  hasMinItems,
  hasMinimum,
  hasMinLength,
  hasMinProperties,
  hasMultipleOf,
  hasOneOf,
  hasPattern,
  hasProperties,
  hasRef,
  hasRequired,
  hasType,
  hasUniqueItems,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/** Lowercases the first character of a name. e.g. "User" → "user" */
const lowerFirst = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1)

/** Derives the example const name from a type name. e.g. "User" → "userExample" */
const exampleName = (typeName: string): string => `${lowerFirst(typeName)}Example`

/** A representative character for a single regex atom (class body / escape). */
const charForClass = (inner: string): string => {
  if (/a-z/.test(inner)) return 'a'
  if (/A-Z/.test(inner)) return 'A'
  if (/0-9|\\d/.test(inner)) return '5'
  const first = inner.replace(/^\^/, '')[0]
  return first && first !== '\\' ? first : 'a'
}
const charForEscape = (esc: string): string => {
  if (esc === '\\d') return '5'
  if (esc === '\\w') return 'a'
  if (esc === '\\s') return ' '
  return esc[1] ?? 'a'
}

/** Splits `s` on top-level `|`, respecting `[...]` and `(...)` nesting. */
const topLevelAlternatives = (s: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let inClass = false
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    if (c === '\\') {
      cur += c + (s[i + 1] ?? '')
      i++
      continue
    }
    if (inClass) {
      cur += c
      if (c === ']') inClass = false
      continue
    }
    if (c === '[') inClass = true
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === '|' && depth === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  parts.push(cur)
  return parts
}

/**
 * Best-effort generator of a string matching a `pattern`, via recursive descent:
 * anchors, literals, `.`, escapes (`\d`/`\w`/`\s`), character classes, groups
 * (capturing / non-capturing / named), alternation (`a|b` — picks the first
 * usable branch), and the `+`/`*`/`?`/`{n}`/`{n,m}` quantifiers. Lookarounds and
 * backreferences fall through to `undefined`. The caller verifies the result
 * against the real regex and only uses it on a match, so a partial sampler never
 * makes the example worse — it just upgrades the cases it understands.
 */
const sampleFromPattern = (pattern: string, minLength: number): string | undefined => {
  let body = pattern
  if (body.startsWith('^')) body = body.slice(1)
  if (body.endsWith('$') && !body.endsWith('\\$')) body = body.slice(0, -1)

  // Samples one alternation, preferring the first branch that samples cleanly.
  const sampleAlt = (s: string): string | undefined => {
    for (const alt of topLevelAlternatives(s)) {
      const r = sampleSeq(alt)
      if (r !== undefined) return r
    }
    return undefined
  }

  // Samples one concatenation (no top-level `|`).
  const sampleSeq = (seq: string): string | undefined => {
    let out = ''
    let i = 0
    while (i < seq.length) {
      let unit: string | undefined
      const c = seq[i] as string
      if (c === '(') {
        // Find the matching close paren.
        let depth = 1
        let j = i + 1
        for (; j < seq.length && depth > 0; j++) {
          const cj = seq[j]
          if (cj === '\\') {
            j++
            continue
          }
          if (cj === '(') depth++
          else if (cj === ')') depth--
        }
        if (depth !== 0) return undefined
        let inner = seq.slice(i + 1, j - 1)
        if (/^\?[=!]/.test(inner) || /^\?<[=!]/.test(inner)) return undefined // lookaround
        inner = inner.replace(/^\?:/, '').replace(/^\?<[^>]*>/, '')
        unit = sampleAlt(inner)
        if (unit === undefined) return undefined
        i = j
      } else if (c === '[') {
        const end = seq.indexOf(']', i + 1)
        if (end === -1) return undefined
        unit = charForClass(seq.slice(i + 1, end))
        i = end + 1
      } else if (c === '\\') {
        const esc = seq.slice(i, i + 2)
        if (/\d/.test(esc[1] ?? '')) return undefined // backreference
        unit = charForEscape(esc)
        i += 2
      } else if (c === '.') {
        unit = 'a'
        i++
      } else {
        unit = c
        i++
      }

      // Optional quantifier.
      let reps = 1
      const q = seq[i]
      if (q === '+') {
        reps = Math.max(1, minLength)
        i++
      } else if (q === '*') {
        reps = Math.max(0, minLength)
        i++
      } else if (q === '?') {
        reps = 1
        i++
      } else if (q === '{') {
        const end = seq.indexOf('}', i + 1)
        if (end === -1) return undefined
        reps = Number.parseInt(seq.slice(i + 1, end), 10) || 0
        i = end + 1
      }
      out += unit.repeat(reps)
    }
    return out
  }

  return sampleAlt(body)
}

/** Returns a representative string honouring `format`, `pattern`, and length. */
const exampleString = (schema: JSONSchema): string => {
  if (hasFormat(schema)) {
    switch (schema.format) {
      case 'email':
        return 'user@example.com'
      case 'uuid':
        return '00000000-0000-0000-0000-000000000000'
      case 'uri':
      case 'url':
        return 'https://example.com'
      case 'date-time':
        return '1970-01-01T00:00:00.000Z'
      case 'date':
        return '1970-01-01'
      case 'time':
        return '00:00:00.000Z'
      case 'hostname':
        return 'example.com'
      case 'ipv4':
        return '127.0.0.1'
      case 'ipv6':
        return '::1'
    }
  }

  const minLength = hasMinLength(schema) ? schema.minLength : 0
  if (hasPattern(schema)) {
    const sampled = sampleFromPattern(schema.pattern, minLength)
    // Only trust the sampler when it actually matches and fits the length bound.
    if (sampled !== undefined && new RegExp(schema.pattern).test(sampled)) {
      if (!(hasMaxLength(schema) && sampled.length > schema.maxLength)) return sampled
    }
  }

  let value = 'string'
  if (value.length < minLength) value = value.padEnd(minLength, 'x')
  if (hasMaxLength(schema) && value.length > schema.maxLength) value = value.slice(0, schema.maxLength)
  return value
}

/**
 * Derives a single concrete, schema-valid value from a JSON Schema.
 *
 * Prefers explicit hints in this order: `const`, `examples[0]`, `default`,
 * `enum[0]`; otherwise produces a canonical value for the declared type.
 * `$ref`s are resolved and inlined by value; recursive refs short-circuit to
 * `null` (tracked via `seen`).
 *
 * Note: values constrained only by `pattern` are not guaranteed to match the
 * pattern — use the generated arbitrary when pattern fidelity matters.
 */
export const deriveExample = (
  schema: JSONSchema,
  rootSchema?: Record<string, unknown>,
  seen: ReadonlySet<string> = new Set(),
): unknown => {
  if (!isSchemaObject(schema)) return null

  if (hasConst(schema)) return schema.const
  if (hasExamples(schema) && Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0]
  if (hasDefault(schema)) return schema.default
  if (hasEnum(schema) && schema.enum.length > 0) {
    // Prefer the first member that also satisfies any sibling length/range
    // constraints (e.g. `enum` + `minLength`), falling back to the first member.
    const fitting = schema.enum.find((value) => satisfiesScalarConstraints(schema, value))
    return fitting !== undefined ? fitting : schema.enum[0]
  }

  if (hasRef(schema)) {
    const ref = schema.$ref
    if (seen.has(ref) || !rootSchema) return null
    const resolved = resolveRef(ref, rootSchema)
    if (!resolved) return null
    return deriveExample(resolved as JSONSchema, rootSchema, new Set([...seen, ref]))
  }

  const instanceOf = getMjstInstanceOf(schema)
  if (instanceOf === 'Date') return new Date(0)
  const primitive = getMjstPrimitive(schema)
  if (primitive === 'bigint') return 0n

  // `allOf` must satisfy every branch at once, so derive from a single schema
  // that merges the branches (and the node's own keywords) rather than picking
  // one branch — picking one would ignore the others' constraints.
  if (hasAllOf(schema)) return deriveExample(mergeAllOf(schema), rootSchema, seen)

  if (hasOneOf(schema) && schema.oneOf[0] !== undefined) return deriveExample(schema.oneOf[0], rootSchema, seen)
  if (hasAnyOf(schema) && schema.anyOf[0] !== undefined) return deriveExample(schema.anyOf[0], rootSchema, seen)

  if (hasType(schema)) return deriveForType(schema.type, schema, rootSchema, seen)

  // Multi-type schemas (`type: ['string', 'null']`) derive from their first
  // member type; `hasType` only matches a single string `type`.
  if (Array.isArray(schema.type) && schema.type.length > 0) {
    return deriveForType(schema.type[0] as string, schema, rootSchema, seen)
  }

  return null
}

/**
 * True when a candidate value (e.g. an `enum`/`const` member) satisfies the
 * node's simple string-length and numeric-range constraints. Used to pick an
 * `enum` member that also meets a sibling `minLength`/`minimum`/etc.
 */
const satisfiesScalarConstraints = (schema: JSONSchema, value: unknown): boolean => {
  if (typeof value === 'string') {
    if (hasMinLength(schema) && value.length < schema.minLength) return false
    if (hasMaxLength(schema) && value.length > schema.maxLength) return false
  } else if (typeof value === 'number') {
    if (hasMinimum(schema) && value < schema.minimum) return false
    if (hasMaximum(schema) && value > schema.maximum) return false
    if (hasExclusiveMinimum(schema) && value <= schema.exclusiveMinimum) return false
    if (hasExclusiveMaximum(schema) && value >= schema.exclusiveMaximum) return false
    if (hasMultipleOf(schema) && schema.multipleOf > 0 && value % schema.multipleOf !== 0) return false
  }
  return true
}

/** Derives a canonical value for a single declared `type`. */
const deriveForType = (
  type: string,
  schema: JSONSchema,
  rootSchema: Record<string, unknown> | undefined,
  seen: ReadonlySet<string>,
): unknown => {
  switch (type) {
    case 'string':
      return exampleString(schema)
    case 'number':
    case 'integer':
      return deriveNumber(schema, type === 'integer')
    case 'boolean':
      return true
    case 'null':
      return null
    case 'array':
      return deriveArray(schema, rootSchema, seen)
    case 'object': {
      const out: Record<string, unknown> = {}
      if (hasProperties(schema)) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          out[key] = deriveExample(propSchema, rootSchema, seen)
        }
      }
      const additional = hasAdditionalProperties(schema) ? schema.additionalProperties : false
      const additionalSchema = isSchemaObject(additional) ? additional : undefined
      // Extra keys are allowed unless `additionalProperties: false` forbids them.
      const extrasAllowed = !(hasAdditionalProperties(schema) && schema.additionalProperties === false)
      // A required key with no `properties` entry still needs a value. Use the
      // `additionalProperties` schema when one constrains it, else a null.
      if (hasRequired(schema)) {
        for (const key of schema.required) {
          if (key in out) continue
          out[key] = additionalSchema ? deriveExample(additionalSchema, rootSchema, seen) : null
        }
      }
      // Synthesize filler keys to reach `minProperties` when extras are allowed.
      if (hasMinProperties(schema) && extrasAllowed) {
        let n = 0
        while (Object.keys(out).length < schema.minProperties) {
          const key = `extra${n++}`
          if (key in out) continue
          out[key] = additionalSchema ? deriveExample(additionalSchema, rootSchema, seen) : null
        }
      }
      return out
    }
    default:
      return null
  }
}

/**
 * Picks a number satisfying the node's bounds and `multipleOf`. Starts at the
 * lower bound (or 0 when unbounded), nudges past an exclusive bound, then rounds
 * up to the nearest multiple. An unsatisfiable range (e.g. `minimum > maximum`)
 * can't be met and falls back to the lower bound.
 */
const deriveNumber = (schema: JSONSchema, isInteger: boolean): number => {
  const step = isInteger ? 1 : 0.5
  let lo = -Infinity
  if (hasMinimum(schema)) lo = Math.max(lo, schema.minimum)
  if (hasExclusiveMinimum(schema)) lo = Math.max(lo, schema.exclusiveMinimum + step)
  const hi = hasMaximum(schema)
    ? schema.maximum
    : hasExclusiveMaximum(schema)
      ? schema.exclusiveMaximum - step
      : Number.POSITIVE_INFINITY

  // Base candidate: the lower bound, or 0 (or the upper bound) when unbounded below.
  let value = Number.isFinite(lo) ? lo : Number.isFinite(hi) ? Math.min(0, hi) : 0
  if (isInteger) value = Math.ceil(value)

  if (hasMultipleOf(schema) && schema.multipleOf > 0) {
    const m = schema.multipleOf
    value = Math.ceil(value / m - 1e-9) * m
    // Rounding up can overshoot the upper bound; drop to the largest multiple
    // that fits. (If even that falls below `lo`, the range has no multiple — an
    // unsatisfiable schema — and we return the in-range candidate as best effort.)
    if (value > hi && Number.isFinite(hi)) value = Math.floor(hi / m + 1e-9) * m
  }
  // `+ 0` normalizes a `-0` (which `Math.ceil`/`Math.floor` can produce) to `0`.
  return (isInteger ? Math.round(value) : value) + 0
}

/**
 * Derives an array value. A tuple schema (`prefixItems`, or the draft-07
 * array-form `items`) derives one value per position; a uniform array repeats a
 * single item value. The count is clamped into `[minItems, maxItems]` so a
 * `maxItems: 0` yields `[]` and a `minItems` is always met.
 */
const deriveArray = (
  schema: JSONSchema,
  rootSchema: Record<string, unknown> | undefined,
  seen: ReadonlySet<string>,
): unknown[] => {
  const items = hasItems(schema) ? schema.items : undefined
  const prefixItems = (schema as Record<string, unknown>)['prefixItems']
  // A tuple is `prefixItems` (2020-12) or the draft-07 array-form `items`.
  const prefix = Array.isArray(prefixItems)
    ? (prefixItems as JSONSchema[])
    : Array.isArray(items)
      ? (items as JSONSchema[])
      : undefined

  const min = hasMinItems(schema) ? schema.minItems : 0
  const max = hasMaxItems(schema) ? schema.maxItems : Number.POSITIVE_INFINITY
  // The rest/uniform element schema (the singular object-form `items`). A boolean
  // `items` (`true`/`false`) is not a value-producing schema, so it is not `rest`.
  const rest = items !== undefined && !Array.isArray(items) && isSchemaObject(items) ? items : undefined

  if (prefix) {
    const tuple = prefix.map((item) => deriveExample(item, rootSchema, seen))
    // Pad up to `minItems`: with the rest schema when one is present, otherwise
    // (in 2020-12 additional items past `prefixItems` are unconstrained unless
    // `items: false`) with a plain `null`.
    const itemsClosed = (schema as Record<string, unknown>)['items'] === false
    while (tuple.length < min && tuple.length < max) {
      if (rest !== undefined) tuple.push(deriveExample(rest, rootSchema, seen))
      else if (itemsClosed) break
      else tuple.push(null)
    }
    return tuple.length > max ? tuple.slice(0, max) : tuple
  }

  const raw = schema as Record<string, unknown>
  const containsRaw = raw['contains'] as JSONSchema | undefined
  const contains = containsRaw !== undefined && isSchemaObject(containsRaw) ? containsRaw : undefined
  const minContains =
    contains !== undefined ? (typeof raw['minContains'] === 'number' ? (raw['minContains'] as number) : 1) : 0
  const unique = hasUniqueItems(schema) && schema.uniqueItems === true
  // The element schema: the uniform `items`, else the `contains` subschema.
  const elem = rest ?? contains

  // Prefer a non-empty example, satisfy `minItems` and `minContains`, never exceed `maxItems`.
  const count = Math.min(Math.max(min, minContains, max === 0 ? 0 : 1), max)
  const result: unknown[] = []
  for (let i = 0; i < count; i++) {
    // Make the first `minContains` items satisfy `contains`; the rest use `items`.
    const itemSchema = contains !== undefined && i < minContains ? contains : elem
    const base = itemSchema !== undefined ? deriveExample(itemSchema, rootSchema, seen) : null
    result.push(unique ? distinctify(base, i, itemSchema) : base)
  }
  return result
}

/**
 * Returns a value distinct from earlier ones for index `i`, used to satisfy
 * `uniqueItems`, while staying within the item schema's constraints: numbers step
 * by `multipleOf` (so the perturbed values remain valid multiples) rather than by
 * 1, strings are suffixed, booleans alternated. Values that can't be cheaply
 * varied are returned as-is (a best-effort the generated `fast-check` arbitrary
 * covers fully).
 */
const distinctify = (base: unknown, i: number, itemSchema: JSONSchema | undefined): unknown => {
  if (i === 0) return base
  if (typeof base === 'number') {
    const step =
      itemSchema && isSchemaObject(itemSchema) && hasMultipleOf(itemSchema) && itemSchema.multipleOf > 0
        ? itemSchema.multipleOf
        : 1
    return base + i * step
  }
  if (typeof base === 'string') return `${base}${i}`
  if (typeof base === 'boolean') return i % 2 === 1 ? !base : base
  return base
}

/**
 * Flattens an `allOf` into a single schema: object `properties` are merged and
 * `required` unioned across branches, while scalar keywords from later branches
 * (and the node's own keywords) win. `allOf` itself is dropped so the merged
 * schema derives directly.
 */
const TIGHTEST = new Map<string, 'max' | 'min'>([
  ['minimum', 'max'],
  ['exclusiveMinimum', 'max'],
  ['minLength', 'max'],
  ['minItems', 'max'],
  ['minProperties', 'max'],
  ['maximum', 'min'],
  ['exclusiveMaximum', 'min'],
  ['maxLength', 'min'],
  ['maxItems', 'min'],
  ['maxProperties', 'min'],
])

export const mergeAllOf = (schema: JSONSchema): JSONSchema => {
  const branches = hasAllOf(schema) ? schema.allOf : []
  const merged: Record<string, unknown> = {}
  const properties: Record<string, unknown[]> = {}
  const required = new Set<string>()

  for (const branch of [...branches, schema]) {
    if (!isSchemaObject(branch)) continue
    for (const [key, value] of Object.entries(branch)) {
      if (key === 'allOf') continue
      if (key === 'properties' && value && typeof value === 'object') {
        // The same property constrained by several branches must satisfy all of
        // them, so collect each schema and combine them below rather than letting
        // a later branch's schema silently replace an earlier one.
        for (const [prop, propSchema] of Object.entries(value)) {
          const bucket = properties[prop]
          if (bucket) bucket.push(propSchema)
          else properties[prop] = [propSchema]
        }
      } else if (key === 'required' && Array.isArray(value)) {
        for (const r of value) required.add(r as string)
      } else if (key === 'enum' && Array.isArray(value)) {
        // A value must be in *every* branch's enum, so intersect rather than let
        // a later branch's enum replace an earlier one (which could pick a member
        // the earlier branch rejects).
        merged['enum'] = Array.isArray(merged['enum'])
          ? (merged['enum'] as unknown[]).filter((member) => value.includes(member))
          : value
      } else if (TIGHTEST.has(key) && typeof value === 'number' && typeof merged[key] === 'number') {
        // Numeric bounds from different branches combine to the tightest one.
        merged[key] = TIGHTEST.get(key) === 'max' ? Math.max(merged[key], value) : Math.min(merged[key], value)
      } else {
        merged[key] = value
      }
    }
  }

  const mergedProps: Record<string, unknown> = {}
  for (const [prop, schemas] of Object.entries(properties)) {
    mergedProps[prop] = schemas.length === 1 ? schemas[0] : { allOf: schemas }
  }
  if (Object.keys(mergedProps).length > 0) merged['properties'] = mergedProps
  if (required.size > 0) merged['required'] = [...required]
  return merged as JSONSchema
}

/**
 * Serializes a derived value into a TypeScript source expression. Handles the
 * non-JSON values `deriveExample` can produce (`Date`, `bigint`) in addition to
 * plain JSON.
 */
export const serializeValue = (value: unknown): string => {
  if (typeof value === 'bigint') return `${value}n`
  if (value instanceof Date) return `new Date(${JSON.stringify(value.toISOString())})`
  if (Array.isArray(value)) return `[${value.map(serializeValue).join(', ')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([key, v]) => `${JSON.stringify(key)}: ${serializeValue(v)}`)
    return `{ ${entries.join(', ')} }`
  }
  return JSON.stringify(value)
}

/**
 * Generates an exported const holding a concrete, schema-valid example value.
 *
 * @example
 * ```typescript
 * generateExampleConst({ type: 'object', properties: { name: { type: 'string' } } }, 'Info')
 * // export const infoExample: Info = { "name": "string" }
 * ```
 */
export const generateExampleConst = (
  schema: JSONSchema,
  typeName: string,
  rootSchema?: Record<string, unknown>,
): string => {
  const value = deriveExample(schema, rootSchema)
  return `export const ${exampleName(typeName)}: ${typeName} = ${serializeValue(value)}`
}
