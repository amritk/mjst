/**
 * What {@link generateGuardSource} hands the emitter: hoisted declarations
 * (compiled regexes), the guard arrow expression, and which shared preamble
 * helpers the emitted code references (`codePoints`, `compileRx` — the
 * emitter includes them once per module when any guard needs them).
 */
export type GeneratedGuard = {
  readonly declarations: readonly string[]
  readonly expression: string
  readonly usesCodePoints: boolean
  readonly usesCompileRx: boolean
}

/**
 * Emits a straight-line boolean guard (as JavaScript source) for the schema
 * subset whose interpreter semantics it can reproduce exactly: explicit
 * primitive/object/array types, string length (code points, like the
 * interpreter) and `pattern`, numeric bounds, primitive `enum`/`const`,
 * OpenAPI `nullable: true`, `additionalProperties: false`, `required`, and
 * nested objects/arrays of the same subset. Annotation keywords (`title`,
 * `description`, `format`, …) are ignored, exactly as the interpreter ignores
 * them.
 *
 * Returns `undefined` the moment anything falls outside that subset — the
 * emitter then falls back to the runtime interpreter, which implements all of
 * JSON Schema. Bailing instead of approximating is what keeps the compiled
 * and runtime engines semantically identical; the differential test enforces
 * it.
 */
export const generateGuardSource = (schema: unknown, prefix: string): GeneratedGuard | undefined => {
  const state: GuardState = { counter: 0, declarations: [], usesCodePoints: false, usesCompileRx: false, prefix }
  const checks = emitChecks(schema, 'input', '  ', state)
  if (checks === undefined) return undefined
  return {
    declarations: state.declarations,
    expression: ['(input) => {', ...checks, '  return true', '}'].join('\n'),
    usesCodePoints: state.usesCodePoints,
    usesCompileRx: state.usesCompileRx,
  }
}

type GuardState = {
  counter: number
  declarations: string[]
  usesCodePoints: boolean
  usesCompileRx: boolean
  readonly prefix: string
}

/**
 * Keywords that never affect validation — the interpreter reads specific
 * keys and these are not among them, so ignoring them preserves the verdict.
 * (`format` is annotation-only here because the pipeline never opts into
 * format enforcement.)
 */
const ANNOTATIONS = new Set([
  'title',
  'description',
  'default',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
  '$comment',
  'format',
])

/**
 * Property names the interpreter tests with `Object.hasOwn` instead of the
 * `!== undefined` fast path (they shadow `Object.prototype` members). The
 * inline form only emits the fast path, so schemas declaring these bail.
 */
const PROTO_KEYS = new Set([
  'constructor',
  '__proto__',
  'prototype',
  'toString',
  'toLocaleString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
])

const isPrimitiveValue = (value: unknown): boolean =>
  value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

/** The positive condition for one `type` keyword entry, mirroring matchesType. */
const typeCondition = (type: unknown, value: string): string | undefined => {
  switch (type) {
    case 'string':
      return `typeof ${value} === 'string'`
    case 'number':
      return `typeof ${value} === 'number'`
    case 'integer':
      return `Number.isInteger(${value})`
    case 'boolean':
      return `typeof ${value} === 'boolean'`
    case 'null':
      return `${value} === null`
    case 'object':
      return `typeof ${value} === 'object' && ${value} !== null && !Array.isArray(${value})`
    case 'array':
      return `Array.isArray(${value})`
    default:
      return undefined
  }
}

/**
 * Emits the failing checks for one subschema against an identifier. Returns
 * `undefined` to bail (propagated all the way out). `value` must be a bare
 * identifier so re-evaluation is free.
 */
const emitChecks = (schema: unknown, value: string, indent: string, state: GuardState): string[] | undefined => {
  if (schema === true) return []
  if (schema === false) return [`${indent}return false`]
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return undefined
  const node = schema as Record<string, unknown>

  const keys = new Set(Object.keys(node).filter((key) => !ANNOTATIONS.has(key)))

  // OpenAPI nullable: a null value passes the whole subschema, before any
  // other keyword is considered — so every other check nests under V !== null.
  if (keys.has('nullable')) {
    if (node['nullable'] !== true) return undefined
    keys.delete('nullable')
    const rest = Object.fromEntries([...keys].map((key) => [key, node[key]]))
    const inner = emitChecks(rest, value, indent + '  ', state)
    if (inner === undefined) return undefined
    if (inner.length === 0) return []
    return [`${indent}if (${value} !== null) {`, ...inner, `${indent}}`]
  }

  const lines: string[] = []
  const take = (key: string): unknown => {
    keys.delete(key)
    return node[key]
  }

  if (keys.has('const')) {
    const constant = take('const')
    if (!isPrimitiveValue(constant)) return undefined
    lines.push(`${indent}if (${value} !== ${JSON.stringify(constant)}) return false`)
  }
  if (keys.has('enum')) {
    const values = take('enum')
    if (!Array.isArray(values) || values.length === 0 || !values.every(isPrimitiveValue)) return undefined
    lines.push(`${indent}if (${values.map((v) => `${value} !== ${JSON.stringify(v)}`).join(' && ')}) return false`)
  }

  const type = keys.has('type') ? take('type') : undefined
  if (Array.isArray(type)) {
    // A type union composes with enum/const but not with per-type constraint
    // keywords (those would need to apply conditionally per branch).
    if (keys.size > 0) return undefined
    const conditions = type.map((entry) => typeCondition(entry, value))
    if (conditions.some((condition) => condition === undefined) || conditions.length === 0) return undefined
    lines.push(`${indent}if (!(${conditions.map((c) => `(${c})`).join(' || ')})) return false`)
    return lines
  }

  switch (type) {
    case undefined: {
      // No type: only enum/const (already handled) are expressible inline.
      return keys.size === 0 ? lines : undefined
    }
    case 'string': {
      lines.push(`${indent}if (typeof ${value} !== 'string') return false`)
      if (keys.has('minLength')) {
        const min = take('minLength')
        if (typeof min !== 'number') return undefined
        if (min > 0) {
          state.usesCodePoints = true
          lines.push(`${indent}if (codePoints(${value}) < ${min}) return false`)
        }
      }
      if (keys.has('maxLength')) {
        const max = take('maxLength')
        if (typeof max !== 'number') return undefined
        state.usesCodePoints = true
        lines.push(`${indent}if (codePoints(${value}) > ${max}) return false`)
      }
      if (keys.has('pattern')) {
        const pattern = take('pattern')
        if (typeof pattern !== 'string') return undefined
        state.usesCompileRx = true
        const name = `${state.prefix}_rx${state.counter++}`
        state.declarations.push(`const ${name} = compileRx(${JSON.stringify(pattern)})`)
        lines.push(`${indent}if (!${name}.test(${value})) return false`)
      }
      return keys.size === 0 ? lines : undefined
    }
    case 'number':
    case 'integer': {
      lines.push(
        type === 'integer'
          ? `${indent}if (!Number.isInteger(${value})) return false`
          : `${indent}if (typeof ${value} !== 'number') return false`,
      )
      for (const [keyword, operator] of [
        ['minimum', '<'],
        ['maximum', '>'],
        ['exclusiveMinimum', '<='],
        ['exclusiveMaximum', '>='],
      ] as const) {
        if (!keys.has(keyword)) continue
        const bound = take(keyword)
        // Draft-04 boolean exclusive* changes meaning — bail rather than guess.
        if (typeof bound !== 'number') return undefined
        lines.push(`${indent}if (${value} ${operator} ${JSON.stringify(bound)}) return false`)
      }
      return keys.size === 0 ? lines : undefined
    }
    case 'boolean': {
      lines.push(`${indent}if (typeof ${value} !== 'boolean') return false`)
      return keys.size === 0 ? lines : undefined
    }
    case 'null': {
      lines.push(`${indent}if (${value} !== null) return false`)
      return keys.size === 0 ? lines : undefined
    }
    case 'object':
      return emitObjectChecks(node, keys, take, lines, value, indent, state)
    case 'array':
      return emitArrayChecks(keys, take, lines, value, indent, state)
    default:
      return undefined
  }
}

const emitObjectChecks = (
  node: Record<string, unknown>,
  keys: Set<string>,
  take: (key: string) => unknown,
  lines: string[],
  value: string,
  indent: string,
  state: GuardState,
): string[] | undefined => {
  lines.push(`${indent}if (typeof ${value} !== 'object' || ${value} === null || Array.isArray(${value})) return false`)

  const properties = keys.has('properties') ? take('properties') : {}
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) return undefined
  const required = keys.has('required') ? take('required') : []
  if (!Array.isArray(required) || required.some((key) => typeof key !== 'string')) return undefined
  const requiredSet = new Set(required as string[])

  const propertyNames = Object.keys(properties)
  // Keys shadowing Object.prototype members need hasOwn presence semantics
  // the inline `!== undefined` form does not provide.
  if ([...propertyNames, ...requiredSet].some((key) => PROTO_KEYS.has(key))) return undefined

  for (const [key, property] of Object.entries(properties)) {
    const variable = `v${state.counter++}`
    lines.push(`${indent}const ${variable} = ${value}[${JSON.stringify(key)}]`)
    if (requiredSet.has(key)) {
      // Explicit presence check: the property's own checks may be empty
      // (schema `true` / `{}`), and required-ness must still hold.
      lines.push(`${indent}if (${variable} === undefined) return false`)
      const inner = emitChecks(property, variable, indent, state)
      if (inner === undefined) return undefined
      lines.push(...inner)
    } else {
      const inner = emitChecks(property, variable, indent + '  ', state)
      if (inner === undefined) return undefined
      if (inner.length > 0) {
        lines.push(`${indent}if (${variable} !== undefined) {`, ...inner, `${indent}}`)
      }
    }
    requiredSet.delete(key)
  }
  // Required keys without a property schema: presence only.
  for (const key of requiredSet) {
    lines.push(`${indent}if (${value}[${JSON.stringify(key)}] === undefined) return false`)
  }

  if (keys.has('additionalProperties')) {
    const additional = take('additionalProperties')
    // `false` is a closed object; anything else (subschema, `true`) would need
    // per-key validation the inline form does not attempt.
    if (additional !== false) return undefined
    const key = `k${state.counter++}`
    const allowed = propertyNames.map((name) => `${key} !== ${JSON.stringify(name)}`).join(' && ')
    lines.push(
      propertyNames.length === 0
        ? `${indent}for (const ${key} in ${value}) return false`
        : `${indent}for (const ${key} in ${value}) if (${allowed}) return false`,
    )
  }

  void node
  return keys.size === 0 ? lines : undefined
}

const emitArrayChecks = (
  keys: Set<string>,
  take: (key: string) => unknown,
  lines: string[],
  value: string,
  indent: string,
  state: GuardState,
): string[] | undefined => {
  lines.push(`${indent}if (!Array.isArray(${value})) return false`)
  if (keys.has('minItems')) {
    const min = take('minItems')
    if (typeof min !== 'number') return undefined
    if (min > 0) lines.push(`${indent}if (${value}.length < ${min}) return false`)
  }
  if (keys.has('maxItems')) {
    const max = take('maxItems')
    if (typeof max !== 'number') return undefined
    lines.push(`${indent}if (${value}.length > ${max}) return false`)
  }
  if (keys.has('items')) {
    const items = take('items')
    if (items !== true) {
      const index = `i${state.counter++}`
      const element = `e${state.counter++}`
      const inner = emitChecks(items, element, indent + '  ', state)
      if (inner === undefined) return undefined
      if (inner.length > 0) {
        lines.push(
          `${indent}for (let ${index} = 0; ${index} < ${value}.length; ${index}++) {`,
          `${indent}  const ${element} = ${value}[${index}]`,
          ...inner,
          `${indent}}`,
        )
      }
    }
  }
  return keys.size === 0 ? lines : undefined
}
