import { escapeRegexPattern } from '@amritk/helpers/escape-regex-pattern'
import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import { refToName } from '@amritk/helpers/ref-to-name'
import { safeAccessor } from '@amritk/helpers/safe-accessor'
import {
  hasAdditionalProperties,
  hasAllOf,
  hasAnyOf,
  hasConst,
  hasDependentRequired,
  hasEnum,
  hasExclusiveMaximum,
  hasExclusiveMinimum,
  hasItems,
  hasMaxItems,
  hasMaximum,
  hasMaxLength,
  hasMinItems,
  hasMinimum,
  hasMinLength,
  hasMultipleOf,
  hasOneOf,
  hasPattern,
  hasProperties,
  hasPropertyNames,
  hasRef,
  hasRequired,
  hasStrictExclusiveMaximum,
  hasStrictExclusiveMinimum,
  hasType,
  hasUniqueItems,
  isObjectSchema,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import { unknownKeyCheck } from '@amritk/helpers/unknown-key-check'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Derives the validator function name from a type name.
 * e.g. "InfoObject" → "validateInfoObject"
 */
const validatorName = (typeName: string): string => `validate${typeName}`

/**
 * Returns the TypeScript typeof string for a JSON Schema primitive type.
 */
const typeofString = (type: string): string => {
  if (type === 'integer') return 'number'
  return type
}

/**
 * Generates the inline condition that is TRUE when `accessor` does NOT equal the
 * `const` value. Primitives compare with `!==`; objects/arrays compare with the
 * runtime `valuesEqual` helper so a reordered-but-equal value still matches (the
 * interpreter uses order-independent deep equality, and `JSON.stringify` would
 * disagree because it is key-order sensitive).
 */
const constMismatchCondition = (accessor: string, value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return `${accessor} !== ${JSON.stringify(value)}`
  }
  return `!valuesEqual(${accessor}, ${JSON.stringify(value)})`
}

/**
 * Generates the inline condition that is TRUE when a value is the wrong type.
 */
const wrongTypeCondition = (accessor: string, type: string): string => {
  switch (type) {
    case 'string':
      return `typeof ${accessor} !== 'string'`
    case 'number':
      return `typeof ${accessor} !== 'number'`
    case 'integer':
      return `typeof ${accessor} !== 'number' || !Number.isInteger(${accessor})`
    case 'boolean':
      return `typeof ${accessor} !== 'boolean'`
    case 'array':
      return `!Array.isArray(${accessor})`
    case 'null':
      return `${accessor} !== null`
    case 'object':
      return `typeof ${accessor} !== 'object' || ${accessor} === null || Array.isArray(${accessor})`
    default:
      return ''
  }
}

/**
 * Where in the object tree the generated checks live. The root context reads
 * from `obj` and reports missing properties at `_path`; every inline nested
 * object gets its own narrowed variable and a longer static path, so checks
 * can recurse to any depth without variable or path collisions.
 */
type NestingContext = {
  /** Generated variable holding the object currently being checked. */
  objVar: string
  /** Template-literal body that evaluates to the current object's path. */
  pathPrefix: string
  /** Inline-object nesting depth, used to mint collision-free variable names. */
  depth: number
  /**
   * Module-level statements to emit before the validator function. Shared by
   * every nesting level of one validator so per-call work (like building a
   * known-keys Set) is paid once at module load instead of on every call.
   */
  hoisted: string[]
}

const createRootContext = (): NestingContext => ({ objVar: 'obj', pathPrefix: '${_path}', depth: 0, hoisted: [] })

/**
 * Returns the `patternProperties` regex sources, or an empty array when the
 * schema declares none. The keys of `patternProperties` are the patterns.
 */
const patternPropertySources = (schema: JSONSchema): string[] => {
  if (!isSchemaObject(schema) || !('patternProperties' in schema)) return []
  const patterns = schema.patternProperties
  if (typeof patterns !== 'object' || patterns === null) return []
  return Object.keys(patterns)
}

/**
 * Generates the unknown-key sweep for `additionalProperties: false`, mirroring
 * the interpreter's behaviour (same error message, one error per extra key).
 * The sweep uses `for...in` — the same allocation-free shape Ajv compiles to.
 * The per-key "is this declared" test comes from `unknownKeyCheck`, which
 * inlines `!==` comparisons for small key counts (faster than `Set.has` and
 * allocation-free) and hoists a known-keys `Set` only when the list is long.
 * When the schema also declares `patternProperties`, a key matching any pattern
 * is not "additional": the patterns are compiled once at module scope (the same
 * regex-caching the interpreter does) and a key survives the sweep if it is a
 * known key or matches any pattern.
 */
const generateStrictKeyChecks = (schema: JSONSchema, ctx: NestingContext): string[] => {
  if (!isSchemaObject(schema)) return []
  if (!hasAdditionalProperties(schema) || schema.additionalProperties !== false) return []

  const known = Object.keys(hasProperties(schema) ? schema.properties : {})
  const d = ctx.depth

  const check = unknownKeyCheck(known, `_knownKeys${ctx.hoisted.length}`)
  ctx.hoisted.push(...check.declarations)

  // A key that matches any `patternProperties` regex is allowed, so only keys
  // outside both the known keys and every pattern count as additional.
  const patterns = patternPropertySources(schema)
  let patternGuard = ''
  if (patterns.length > 0) {
    const patternsName = `_patterns${ctx.hoisted.length}`
    ctx.hoisted.push(`const ${patternsName} = [${patterns.map((p) => `new RegExp(${JSON.stringify(p)})`).join(', ')}]`)
    patternGuard = ` && !${patternsName}.some((re) => re.test(_key${d}))`
  }

  return [
    `  for (const _key${d} in ${ctx.objVar}) {`,
    `    if (${check.isUnknown(`_key${d}`)}${patternGuard}) {`,
    `      errors.push({ message: 'must NOT have additional properties', path: \`${ctx.pathPrefix}/\${_key${d}}\` })`,
    `    }`,
    `  }`,
  ]
}

/**
 * Emits presence checks for `required` keys that have no `properties` entry.
 * Keys present in `properties` get their missing-property check from
 * {@link generatePropertyChecks}; a required key with no schema of its own would
 * otherwise go unchecked, so its presence is enforced here to match the
 * interpreter and Ajv.
 */
const generateMissingRequiredChecks = (schema: JSONSchema, ctx: NestingContext): string[] => {
  if (!isSchemaObject(schema) || !hasRequired(schema)) return []
  const props = hasProperties(schema) ? schema.properties : {}
  const parentPath = ctx.depth === 0 ? '_path' : `\`${ctx.pathPrefix}\``
  const lines: string[] = []
  for (const key of schema.required) {
    if (Object.hasOwn(props, key)) continue
    lines.push(`  if (!(${JSON.stringify(key)} in ${ctx.objVar})) {`)
    lines.push(
      `    errors.push({ message: ${JSON.stringify(`must have required property '${key}'`)}, path: ${parentPath} })`,
    )
    lines.push(`  }`)
  }
  return lines
}

/**
 * Generates validation lines for a single property in an object schema.
 * Handles $ref delegation, enum checks, type checks, string/number constraints,
 * and recursion into inline nested objects.
 */
const generatePropertyChecks = (
  key: string,
  propSchema: JSONSchema,
  isRequired: boolean,
  suffix: string,
  ctx: NestingContext,
): string[] => {
  if (!isSchemaObject(propSchema)) return []

  const raw = `${ctx.objVar}[${JSON.stringify(key)}]`
  const path = `\`${ctx.pathPrefix}/${key}\``
  // Missing-property errors report at the parent object's path. At the root
  // that is the `_path` parameter itself; inside nested objects it is the
  // parent's accumulated static path.
  const parentPath = ctx.depth === 0 ? '_path' : `\`${ctx.pathPrefix}\``
  const lines: string[] = []

  // $ref — delegate to the imported validator
  if (hasRef(propSchema)) {
    const ref = propSchema.$ref
    const vName = validatorName(refToName(ref, suffix))

    if (isRequired) {
      lines.push(`  if (!(${JSON.stringify(key)} in ${ctx.objVar})) {`)
      lines.push(
        `    errors.push({ message: ${JSON.stringify(`must have required property '${key}'`)}, path: ${parentPath} })`,
      )
      lines.push(`  } else {`)
      lines.push(`    const _r = ${vName}(${raw}, ${path})`)
      lines.push(`    if (_r !== true) errors.push(..._r.errors)`)
      lines.push(`  }`)
    } else {
      lines.push(`  if (${raw} !== undefined) {`)
      lines.push(`    const _r = ${vName}(${raw}, ${path})`)
      lines.push(`    if (_r !== true) errors.push(..._r.errors)`)
      lines.push(`  }`)
    }
    return lines
  }

  // x-mjst instanceOf (e.g. Date) — value must be an instance of the class
  const instanceOf = getMjstInstanceOf(propSchema)
  if (instanceOf) {
    if (isRequired) {
      lines.push(`  if (!(${JSON.stringify(key)} in ${ctx.objVar})) {`)
      lines.push(
        `    errors.push({ message: ${JSON.stringify(`must have required property '${key}'`)}, path: ${parentPath} })`,
      )
      lines.push(`  } else if (!(${raw} instanceof ${instanceOf})) {`)
      lines.push(`    errors.push({ message: 'must be ${instanceOf}', path: ${path} })`)
      lines.push(`  }`)
    } else {
      lines.push(`  if (${raw} !== undefined && !(${raw} instanceof ${instanceOf})) {`)
      lines.push(`    errors.push({ message: 'must be ${instanceOf}', path: ${path} })`)
      lines.push(`  }`)
    }
    return lines
  }

  // x-mjst primitive (e.g. bigint) — value must satisfy a typeof check
  const primitive = getMjstPrimitive(propSchema)
  if (primitive) {
    if (isRequired) {
      lines.push(`  if (!(${JSON.stringify(key)} in ${ctx.objVar})) {`)
      lines.push(
        `    errors.push({ message: ${JSON.stringify(`must have required property '${key}'`)}, path: ${parentPath} })`,
      )
      lines.push(`  } else if (typeof ${raw} !== "${primitive}") {`)
      lines.push(`    errors.push({ message: 'must be ${primitive}', path: ${path} })`)
      lines.push(`  }`)
    } else {
      lines.push(`  if (${raw} !== undefined && typeof ${raw} !== "${primitive}") {`)
      lines.push(`    errors.push({ message: 'must be ${primitive}', path: ${path} })`)
      lines.push(`  }`)
    }
    return lines
  }

  // const — value must equal the fixed value exactly
  if (hasConst(propSchema)) {
    const mismatch = constMismatchCondition(raw, propSchema.const)
    const msg = JSON.stringify(`must be ${JSON.stringify(propSchema.const)}`)
    if (isRequired) {
      lines.push(`  if (!(${JSON.stringify(key)} in ${ctx.objVar})) {`)
      lines.push(
        `    errors.push({ message: ${JSON.stringify(`must have required property '${key}'`)}, path: ${parentPath} })`,
      )
      lines.push(`  } else if (${mismatch}) {`)
      lines.push(`    errors.push({ message: ${msg}, path: ${path} })`)
      lines.push(`  }`)
    } else {
      lines.push(`  if (${raw} !== undefined && ${mismatch}) {`)
      lines.push(`    errors.push({ message: ${msg}, path: ${path} })`)
      lines.push(`  }`)
    }
    return lines
  }

  // enum
  if (hasEnum(propSchema)) {
    const allowed = JSON.stringify(propSchema.enum)
    const label = (propSchema.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')

    if (isRequired) {
      lines.push(`  if (!(${JSON.stringify(key)} in ${ctx.objVar})) {`)
      lines.push(
        `    errors.push({ message: ${JSON.stringify(`must have required property '${key}'`)}, path: ${parentPath} })`,
      )
      lines.push(`  } else if (!(${allowed} as unknown[]).includes(${raw})) {`)
      lines.push(`    errors.push({ message: ${JSON.stringify(`must be one of: ${label}`)}, path: ${path} })`)
      lines.push(`  }`)
    } else {
      lines.push(`  if (${raw} !== undefined && !(${allowed} as unknown[]).includes(${raw})) {`)
      lines.push(`    errors.push({ message: ${JSON.stringify(`must be one of: ${label}`)}, path: ${path} })`)
      lines.push(`  }`)
    }
    return lines
  }

  // typed property
  if (hasType(propSchema)) {
    const t = propSchema.type as string
    const wrongType = wrongTypeCondition(raw, t)
    const typLabel = typeofString(t)

    if (isRequired) {
      lines.push(`  if (!(${JSON.stringify(key)} in ${ctx.objVar})) {`)
      lines.push(
        `    errors.push({ message: ${JSON.stringify(`must have required property '${key}'`)}, path: ${parentPath} })`,
      )
      if (wrongType) {
        lines.push(`  } else if (${wrongType}) {`)
        lines.push(`    errors.push({ message: 'must be ${typLabel}', path: ${path} })`)
      }
      lines.push(`  }`)
    } else if (wrongType) {
      lines.push(`  if (${raw} !== undefined && (${wrongType})) {`)
      lines.push(`    errors.push({ message: 'must be ${typLabel}', path: ${path} })`)
      lines.push(`  }`)
    }

    lines.push(...generateConstraintChecks(key, raw, path, propSchema, suffix, ctx))
  }

  // Keywords that can sit alongside or instead of `type`: combinators
  // (`allOf`/`anyOf`/`oneOf`/`not`/`if`) for any schema, plus the constraint
  // checks for a *type-less* schema (e.g. a bare `{ required: [...] }` or
  // `{ minItems: 2 }` property). A typed schema already ran its constraints in
  // the `hasType` branch above, so it only needs the combinators here.
  const extraLines = hasType(propSchema)
    ? generateCombinatorChecks(key, raw, path, propSchema, suffix, ctx)
    : [
        ...generateConstraintChecks(key, raw, path, propSchema, suffix, ctx),
        ...generateCombinatorChecks(key, raw, path, propSchema, suffix, ctx),
      ]
  if (extraLines.length > 0) {
    if (!hasType(propSchema) && isRequired) {
      // No `type` to anchor a missing-property check, so enforce presence here.
      lines.push(`  if (!(${JSON.stringify(key)} in ${ctx.objVar})) {`)
      lines.push(
        `    errors.push({ message: ${JSON.stringify(`must have required property '${key}'`)}, path: ${parentPath} })`,
      )
      lines.push(`  } else {`)
      lines.push(...extraLines)
      lines.push(`  }`)
    } else {
      lines.push(`  if (${raw} !== undefined) {`)
      lines.push(...extraLines)
      lines.push(`  }`)
    }
  }

  return lines
}

/**
 * Emits the value-shape constraints for a typed value: string (pattern,
 * min/maxLength), number/integer (bounds, multipleOf), typed/`$ref` array items,
 * and recursion into an inline nested object. Shared by the named-property path
 * ({@link generatePropertyChecks}) and the dynamic-key path
 * ({@link generateValueChecks}) so both enforce identical rules. `raw` and `path`
 * are arbitrary expressions, so the same logic serves a static `obj.key` and a
 * `patternProperties` / `additionalProperties` value read at a runtime key.
 */
const generateConstraintChecks = (
  key: string,
  raw: string,
  path: string,
  propSchema: JSONSchema,
  suffix: string,
  ctx: NestingContext,
): string[] => {
  if (!isSchemaObject(propSchema)) return []
  const sp = propSchema as Record<string, unknown>
  const lines: string[] = []

  // Each block is gated on the *presence of its keywords*, not a declared `type`,
  // and every emitted check carries its own runtime-type guard (`typeof` /
  // `Array.isArray`). So a type-less schema (e.g. an `allOf` / `anyOf` / `not`
  // branch that is just `{ required: [...] }` or `{ minItems: 2 }`) is validated
  // against the value's runtime type, matching the interpreter.

  // String constraints
  if (hasPattern(propSchema) || hasMinLength(propSchema) || hasMaxLength(propSchema)) {
    if (hasPattern(propSchema)) {
      const re = escapeRegexPattern(propSchema.pattern)
      const msg = JSON.stringify(`must match pattern ${propSchema.pattern}`)
      lines.push(`  if (typeof ${raw} === 'string' && !/${re}/.test(${raw})) {`)
      lines.push(`    errors.push({ message: ${msg}, path: ${path} })`)
      lines.push(`  }`)
    }
    if (hasMinLength(propSchema)) {
      lines.push(`  if (typeof ${raw} === 'string' && ${raw}.length < ${propSchema.minLength}) {`)
      lines.push(`    errors.push({ message: 'must have at least ${propSchema.minLength} characters', path: ${path} })`)
      lines.push(`  }`)
    }
    if (hasMaxLength(propSchema)) {
      lines.push(`  if (typeof ${raw} === 'string' && ${raw}.length > ${propSchema.maxLength}) {`)
      lines.push(`    errors.push({ message: 'must have at most ${propSchema.maxLength} characters', path: ${path} })`)
      lines.push(`  }`)
    }
  }

  // Number constraints
  if (
    hasMinimum(propSchema) ||
    hasMaximum(propSchema) ||
    hasExclusiveMinimum(propSchema) ||
    hasExclusiveMaximum(propSchema) ||
    hasMultipleOf(propSchema)
  ) {
    if (hasMinimum(propSchema)) {
      // Draft-04 `exclusiveMinimum: true` makes the paired `minimum` strict.
      const strict = hasStrictExclusiveMinimum(propSchema)
      const op = strict ? '<=' : '<'
      const rel = strict ? '>' : '>='
      lines.push(`  if (typeof ${raw} === 'number' && ${raw} ${op} ${propSchema.minimum}) {`)
      lines.push(`    errors.push({ message: 'must be ${rel} ${propSchema.minimum}', path: ${path} })`)
      lines.push(`  }`)
    }
    if (hasMaximum(propSchema)) {
      const strict = hasStrictExclusiveMaximum(propSchema)
      const op = strict ? '>=' : '>'
      const rel = strict ? '<' : '<='
      lines.push(`  if (typeof ${raw} === 'number' && ${raw} ${op} ${propSchema.maximum}) {`)
      lines.push(`    errors.push({ message: 'must be ${rel} ${propSchema.maximum}', path: ${path} })`)
      lines.push(`  }`)
    }
    if (hasExclusiveMinimum(propSchema)) {
      lines.push(`  if (typeof ${raw} === 'number' && ${raw} <= ${propSchema.exclusiveMinimum}) {`)
      lines.push(`    errors.push({ message: 'must be > ${propSchema.exclusiveMinimum}', path: ${path} })`)
      lines.push(`  }`)
    }
    if (hasExclusiveMaximum(propSchema)) {
      lines.push(`  if (typeof ${raw} === 'number' && ${raw} >= ${propSchema.exclusiveMaximum}) {`)
      lines.push(`    errors.push({ message: 'must be < ${propSchema.exclusiveMaximum}', path: ${path} })`)
      lines.push(`  }`)
    }
    if (hasMultipleOf(propSchema)) {
      lines.push(`  if (typeof ${raw} === 'number' && ${raw} % ${propSchema.multipleOf} !== 0) {`)
      lines.push(`    errors.push({ message: 'must be a multiple of ${propSchema.multipleOf}', path: ${path} })`)
      lines.push(`  }`)
    }
  }

  // Array with typed items
  if (hasItems(propSchema)) {
    const itemSchema = propSchema.items
    if (hasRef(itemSchema)) {
      const vName = validatorName(refToName(itemSchema.$ref, suffix))
      lines.push(`  if (Array.isArray(${raw})) {`)
      lines.push(`    for (let _i = 0; _i < ${raw}.length; _i++) {`)
      lines.push(`      const _ir = ${vName}(${raw}[_i], \`${path.slice(1, -1)}/\${_i}\`)`)
      lines.push(`      if (_ir !== true) errors.push(..._ir.errors)`)
      lines.push(`    }`)
      lines.push(`  }`)
    } else if (hasType(itemSchema)) {
      const itemType = itemSchema.type as string
      const itemWrong = wrongTypeCondition('_item', itemType)
      const itemLabel = typeofString(itemType)
      if (itemWrong) {
        lines.push(`  if (Array.isArray(${raw})) {`)
        lines.push(`    for (let _i = 0; _i < ${raw}.length; _i++) {`)
        lines.push(`      const _item = ${raw}[_i]`)
        lines.push(
          `      if (${itemWrong}) errors.push({ message: 'items must be ${itemLabel}', path: \`${path.slice(1, -1)}/\${_i}\` })`,
        )
        lines.push(`    }`)
        lines.push(`  }`)
      }
    }
  }

  // Array length / uniqueness. `uniqueItems` dedupes by a JSON projection — exact
  // for primitives (what the type guard also uses); deep-but-key-ordered for
  // objects, the same pragmatic trade-off the rest of the generator makes.
  if (
    hasMinItems(propSchema) ||
    hasMaxItems(propSchema) ||
    (hasUniqueItems(propSchema) && propSchema.uniqueItems === true) ||
    isSchemaObject(sp['contains'] as JSONSchema) ||
    Array.isArray(sp['prefixItems'])
  ) {
    if (hasMinItems(propSchema)) {
      lines.push(`  if (Array.isArray(${raw}) && ${raw}.length < ${propSchema.minItems}) {`)
      lines.push(`    errors.push({ message: 'must have at least ${propSchema.minItems} items', path: ${path} })`)
      lines.push(`  }`)
    }
    if (hasMaxItems(propSchema)) {
      lines.push(`  if (Array.isArray(${raw}) && ${raw}.length > ${propSchema.maxItems}) {`)
      lines.push(`    errors.push({ message: 'must have at most ${propSchema.maxItems} items', path: ${path} })`)
      lines.push(`  }`)
    }
    if (hasUniqueItems(propSchema) && propSchema.uniqueItems === true) {
      lines.push(
        `  if (Array.isArray(${raw}) && new Set((${raw} as unknown[]).map((_u) => JSON.stringify(_u))).size !== ${raw}.length) {`,
      )
      lines.push(`    errors.push({ message: 'must NOT have duplicate items', path: ${path} })`)
      lines.push(`  }`)
    }

    // `contains` — at least `minContains` (default 1) and at most `maxContains`
    // items must match the subschema. `minContains: 0` makes any array (even
    // empty) satisfy the lower bound.
    if (isSchemaObject(sp['contains'] as JSONSchema)) {
      const min = typeof sp['minContains'] === 'number' ? sp['minContains'] : 1
      const max = typeof sp['maxContains'] === 'number' ? (sp['maxContains'] as number) : undefined
      const matchExpr = generateMatchesExpr('_c', sp['contains'] as JSONSchema, suffix, ctx)
      const bound = max !== undefined ? `_cn < ${min} || _cn > ${max}` : `_cn < ${min}`
      lines.push(`  if (Array.isArray(${raw})) {`)
      lines.push(`    const _cn = (${raw} as unknown[]).filter((_c) => ${matchExpr}).length`)
      lines.push(`    if (${bound}) {`)
      lines.push(`      errors.push({ message: 'array does not contain the required matching items', path: ${path} })`)
      lines.push(`    }`)
      lines.push(`  }`)
    }

    // Tuple `prefixItems` — each position validated against its own subschema; a
    // sibling `items: false` (or draft `additionalItems: false`) caps the length.
    const prefix = sp['prefixItems']
    if (Array.isArray(prefix)) {
      lines.push(`  if (Array.isArray(${raw})) {`)
      for (let i = 0; i < prefix.length; i++) {
        const itemChecks = generateValueChecks(
          '',
          `${raw}[${i}]`,
          `\`${path.slice(1, -1)}/${i}\``,
          prefix[i] as JSONSchema,
          suffix,
          ctx,
        )
        if (itemChecks.length > 0) {
          lines.push(`    if (${raw}.length > ${i}) {`)
          lines.push(...itemChecks.map((l) => `    ${l}`))
          lines.push(`    }`)
        }
      }
      if (sp['items'] === false || sp['additionalItems'] === false) {
        lines.push(`    if (${raw}.length > ${prefix.length}) {`)
        lines.push(`      errors.push({ message: 'must NOT have more than ${prefix.length} items', path: ${path} })`)
        lines.push(`    }`)
      }
      lines.push(`  }`)
    }
  }

  // Inline nested object — recurse so the nested fields are actually validated.
  // Unconditional: `generateInlineObjectChecks` self-gates (returns `[]` when the
  // schema has no object keywords) and each check is guarded by an `isObject`
  // runtime check, so this is a no-op for non-object schemas.
  lines.push(...generateInlineObjectChecks(key, propSchema, raw, suffix, ctx))

  return lines
}

/**
 * Validates a value located at a *dynamic* key (a `patternProperties` or
 * `additionalProperties` schema value) against `propSchema`. Mirrors the
 * optional-property branch of {@link generatePropertyChecks} — the value is
 * always present, so each check is the same `!== undefined`-guarded form — but
 * `raw` and `path` are caller-supplied expressions (e.g. `obj[_k]` and
 * `` `${_path}/${_k}` ``) so the checks read a runtime key.
 */
const generateValueChecks = (
  key: string,
  raw: string,
  path: string,
  propSchema: JSONSchema,
  suffix: string,
  ctx: NestingContext,
): string[] => {
  if (!isSchemaObject(propSchema)) return []
  const lines: string[] = []

  if (hasRef(propSchema)) {
    const vName = validatorName(refToName(propSchema.$ref, suffix))
    lines.push(`  if (${raw} !== undefined) {`)
    lines.push(`    const _r = ${vName}(${raw}, ${path})`)
    lines.push(`    if (_r !== true) errors.push(..._r.errors)`)
    lines.push(`  }`)
    return lines
  }

  const instanceOf = getMjstInstanceOf(propSchema)
  if (instanceOf) {
    lines.push(`  if (${raw} !== undefined && !(${raw} instanceof ${instanceOf})) {`)
    lines.push(`    errors.push({ message: 'must be ${instanceOf}', path: ${path} })`)
    lines.push(`  }`)
    return lines
  }

  const primitive = getMjstPrimitive(propSchema)
  if (primitive) {
    lines.push(`  if (${raw} !== undefined && typeof ${raw} !== "${primitive}") {`)
    lines.push(`    errors.push({ message: 'must be ${primitive}', path: ${path} })`)
    lines.push(`  }`)
    return lines
  }

  if (hasConst(propSchema)) {
    const mismatch = constMismatchCondition(raw, propSchema.const)
    const msg = JSON.stringify(`must be ${JSON.stringify(propSchema.const)}`)
    lines.push(`  if (${raw} !== undefined && ${mismatch}) {`)
    lines.push(`    errors.push({ message: ${msg}, path: ${path} })`)
    lines.push(`  }`)
    return lines
  }

  if (hasEnum(propSchema)) {
    const allowed = JSON.stringify(propSchema.enum)
    const label = (propSchema.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')
    lines.push(`  if (${raw} !== undefined && !(${allowed} as unknown[]).includes(${raw})) {`)
    lines.push(`    errors.push({ message: ${JSON.stringify(`must be one of: ${label}`)}, path: ${path} })`)
    lines.push(`  }`)
    return lines
  }

  if (hasType(propSchema)) {
    const t = propSchema.type as string
    const wrongType = wrongTypeCondition(raw, t)
    const typLabel = typeofString(t)
    if (wrongType) {
      lines.push(`  if (${raw} !== undefined && (${wrongType})) {`)
      lines.push(`    errors.push({ message: 'must be ${typLabel}', path: ${path} })`)
      lines.push(`  }`)
    }
  }

  // Constraint and combinator checks run regardless of a declared `type`: they
  // gate on keyword presence + a runtime-type guard, so a type-less subschema
  // (a combinator branch like `{ required: [...] }` or `{ minItems: 2 }`) is
  // still validated rather than collapsing to "matches everything".
  lines.push(...generateConstraintChecks(key, raw, path, propSchema, suffix, ctx))
  lines.push(...generateCombinatorChecks(key, raw, path, propSchema, suffix, ctx))

  return lines
}

/**
 * A boolean expression that is `true` when `raw` matches `sub`. Reuses the value
 * checks but collects their errors into a throwaway local buffer, so the same
 * logic that produces error messages also answers the yes/no question the
 * combinators (`anyOf`/`oneOf`/`not`/`if`) and `contains` need.
 */
const generateMatchesExpr = (raw: string, sub: JSONSchema, suffix: string, ctx: NestingContext): string => {
  if (sub === true) return 'true'
  if (sub === false) return 'false'
  if (!isSchemaObject(sub)) return 'true'
  const checks = generateValueChecks('', raw, '`${_path}`', sub, suffix, ctx)
  if (checks.length === 0) return 'true'
  // The checks push to `errors`; redirect them to the IIFE-local `_m`. The outer
  // validator's `errors.push` → `(errors ??= [])` rewrite never sees these (they
  // are already `_m.push`), and nested match IIFEs each shadow their own `_m`.
  const body = checks.join('\n').replaceAll('errors.push(', '_m.push(')
  return `((): boolean => { const _m: ValidationError[] = []\n${body}\n    return _m.length === 0 })()`
}

/**
 * Emits the combinator keywords (`allOf`, `anyOf`, `oneOf`, `not`,
 * `if`/`then`/`else`). `allOf` surfaces each branch's errors directly; the others
 * evaluate branch membership as a boolean via {@link generateMatchesExpr}.
 */
const generateCombinatorChecks = (
  key: string,
  raw: string,
  path: string,
  schema: JSONSchema,
  suffix: string,
  ctx: NestingContext,
): string[] => {
  if (!isSchemaObject(schema)) return []
  const lines: string[] = []

  if (hasAllOf(schema)) {
    for (const branch of schema.allOf) lines.push(...generateValueChecks(key, raw, path, branch, suffix, ctx))
  }

  if (hasAnyOf(schema) && schema.anyOf.length > 0) {
    const conds = schema.anyOf.map((b) => generateMatchesExpr(raw, b, suffix, ctx))
    lines.push(`  if (!(${conds.join(' || ')})) {`)
    lines.push(`    errors.push({ message: 'must match a schema in anyOf', path: ${path} })`)
    lines.push(`  }`)
  }

  if (hasOneOf(schema) && schema.oneOf.length > 0) {
    const conds = schema.oneOf.map((b) => `(${generateMatchesExpr(raw, b, suffix, ctx)} ? 1 : 0)`)
    lines.push(`  if ((${conds.join(' + ')}) !== 1) {`)
    lines.push(`    errors.push({ message: 'must match exactly one schema in oneOf', path: ${path} })`)
    lines.push(`  }`)
  }

  const not = (schema as Record<string, unknown>)['not']
  if (not !== undefined && (isSchemaObject(not as JSONSchema) || typeof not === 'boolean')) {
    const cond = generateMatchesExpr(raw, not as JSONSchema, suffix, ctx)
    lines.push(`  if (${cond}) {`)
    lines.push(`    errors.push({ message: 'must NOT match the schema in not', path: ${path} })`)
    lines.push(`  }`)
  }

  const ifSchema = (schema as Record<string, unknown>)['if']
  if (ifSchema !== undefined && (isSchemaObject(ifSchema as JSONSchema) || typeof ifSchema === 'boolean')) {
    const thenSchema = (schema as Record<string, unknown>)['then']
    const elseSchema = (schema as Record<string, unknown>)['else']
    const thenLines =
      thenSchema !== undefined ? generateValueChecks(key, raw, path, thenSchema as JSONSchema, suffix, ctx) : []
    const elseLines =
      elseSchema !== undefined ? generateValueChecks(key, raw, path, elseSchema as JSONSchema, suffix, ctx) : []
    if (thenLines.length > 0 || elseLines.length > 0) {
      lines.push(`  if (${generateMatchesExpr(raw, ifSchema as JSONSchema, suffix, ctx)}) {`)
      lines.push(...thenLines)
      lines.push(`  } else {`)
      lines.push(...elseLines)
      lines.push(`  }`)
    }
  }

  return lines
}

/**
 * Emits validation for `patternProperties` and a schema-form
 * `additionalProperties` (the `false` form is handled by
 * {@link generateStrictKeyChecks}). For each object key, every matching
 * `patternProperties` subschema runs against the value; keys reached by neither
 * `properties` nor any pattern fall through to `additionalProperties`. This
 * mirrors the runtime interpreter, which validates these values rather than only
 * gating extra keys.
 */
const generatePatternAndAdditionalChecks = (schema: JSONSchema, suffix: string, ctx: NestingContext): string[] => {
  if (!isSchemaObject(schema)) return []
  const obj = ctx.objVar
  const d = ctx.depth
  const lines: string[] = []

  const patternsRecord =
    'patternProperties' in schema && typeof schema.patternProperties === 'object' && schema.patternProperties !== null
      ? (schema.patternProperties as Record<string, JSONSchema>)
      : {}
  const patternEntries = Object.entries(patternsRecord)

  for (const [pattern, sub] of patternEntries) {
    const re = escapeRegexPattern(pattern)
    const kv = `_pk${d}`
    const valueChecks = generateValueChecks(
      `\${${kv}}`,
      `${obj}[${kv}]`,
      `\`${ctx.pathPrefix}/\${${kv}}\``,
      sub,
      suffix,
      ctx,
    )
    if (valueChecks.length === 0) continue
    lines.push(`  for (const ${kv} in ${obj}) {`)
    lines.push(`    if (/${re}/.test(${kv})) {`)
    lines.push(...valueChecks.map((line) => `    ${line}`))
    lines.push(`    }`)
    lines.push(`  }`)
  }

  // Schema-form `additionalProperties` validates every key reached by neither a
  // declared property nor any `patternProperties` regex.
  if (hasAdditionalProperties(schema) && isSchemaObject(schema.additionalProperties)) {
    const additional = schema.additionalProperties
    const kv = `_ak${d}`
    const valueChecks = generateValueChecks(
      `\${${kv}}`,
      `${obj}[${kv}]`,
      `\`${ctx.pathPrefix}/\${${kv}}\``,
      additional,
      suffix,
      ctx,
    )
    if (valueChecks.length > 0) {
      const known = Object.keys(hasProperties(schema) ? schema.properties : {})
      lines.push(`  for (const ${kv} in ${obj}) {`)
      if (known.length > 0) lines.push(`    if (${JSON.stringify(known)}.includes(${kv})) continue`)
      for (const pattern of Object.keys(patternsRecord)) {
        lines.push(`    if (/${escapeRegexPattern(pattern)}/.test(${kv})) continue`)
      }
      lines.push(...valueChecks.map((line) => `    ${line}`))
      lines.push(`  }`)
    }
  }

  return lines
}

/**
 * Generates the recursive checks for an inline nested object property, i.e. an
 * object schema written directly under `properties` rather than referenced via
 * `$ref` (those delegate to the referenced validator instead). The value is
 * narrowed into its own block-scoped variable and each nested property runs
 * through the same per-property generator, so nesting works to any depth.
 */
const generateInlineObjectChecks = (
  key: string,
  propSchema: JSONSchema,
  raw: string,
  suffix: string,
  ctx: NestingContext,
): string[] => {
  if (!isSchemaObject(propSchema)) return []

  const child: NestingContext = {
    objVar: `_obj${ctx.depth + 1}`,
    pathPrefix: `${ctx.pathPrefix}/${key}`,
    depth: ctx.depth + 1,
    hoisted: ctx.hoisted,
  }

  const required = new Set(hasRequired(propSchema) ? propSchema.required : [])
  const properties = hasProperties(propSchema) ? propSchema.properties : {}

  const innerLines: string[] = []

  for (const [childKey, childSchema] of Object.entries(properties)) {
    innerLines.push(
      ...generatePropertyChecks(childKey, childSchema as JSONSchema, required.has(childKey), suffix, child),
    )
  }

  innerLines.push(...generateMissingRequiredChecks(propSchema, child))
  innerLines.push(...generatePatternAndAdditionalChecks(propSchema, suffix, child))
  innerLines.push(...generateStrictKeyChecks(propSchema, child))
  innerLines.push(...generateDependentRequiredChecks(propSchema, child))
  if (hasPropertyNames(propSchema) && isSchemaObject(propSchema.propertyNames)) {
    innerLines.push(...generatePropertyNameChecks(propSchema.propertyNames, suffix, child))
  }

  if (innerLines.length === 0) return []

  // The shape check for the property itself already ran (or the property is
  // optional), so re-guard here instead of assuming the value is an object.
  return [
    `  if (typeof ${raw} === 'object' && ${raw} !== null && !Array.isArray(${raw})) {`,
    `    const ${child.objVar} = ${raw} as Record<string, unknown>`,
    ...innerLines.map((line) => `  ${line}`),
    `  }`,
  ]
}

/**
 * Generates the `propertyNames` loop: every object key is a string, so we apply
 * the string-relevant constraints of the subschema (or delegate to a `$ref`'s
 * validator). This keeps the generator in step with the interpreter, which runs
 * the whole subschema against each key — not just the `pattern` form.
 */
const generatePropertyNameChecks = (nameSchema: JSONSchema, suffix: string, ctx: NestingContext): string[] => {
  if (!isSchemaObject(nameSchema)) return []

  const at = `\`${ctx.pathPrefix}/\${_name}\``
  const checks: string[] = []

  if (hasRef(nameSchema)) {
    const vName = validatorName(refToName(nameSchema.$ref, suffix))
    checks.push(`    const _nr = ${vName}(_name, ${at})`)
    checks.push(`    if (_nr !== true) errors.push(..._nr.errors)`)
  } else {
    if (hasPattern(nameSchema)) {
      const re = escapeRegexPattern(nameSchema.pattern)
      const msg = JSON.stringify(`property name must match pattern ${nameSchema.pattern}`)
      checks.push(`    if (!/${re}/.test(_name)) errors.push({ message: ${msg}, path: ${at} })`)
    }
    if (hasMinLength(nameSchema)) {
      const msg = JSON.stringify(`property name must have at least ${nameSchema.minLength} characters`)
      checks.push(`    if (_name.length < ${nameSchema.minLength}) errors.push({ message: ${msg}, path: ${at} })`)
    }
    if (hasMaxLength(nameSchema)) {
      const msg = JSON.stringify(`property name must have at most ${nameSchema.maxLength} characters`)
      checks.push(`    if (_name.length > ${nameSchema.maxLength}) errors.push({ message: ${msg}, path: ${at} })`)
    }
    if (hasEnum(nameSchema)) {
      const allowed = JSON.stringify(nameSchema.enum)
      const label = (nameSchema.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')
      const msg = JSON.stringify(`property name must be one of: ${label}`)
      checks.push(`    if (!(${allowed} as unknown[]).includes(_name)) errors.push({ message: ${msg}, path: ${at} })`)
    }
    if (hasConst(nameSchema)) {
      const msg = JSON.stringify(`property name must be ${JSON.stringify(nameSchema.const)}`)
      checks.push(
        `    if (_name !== ${JSON.stringify(nameSchema.const)}) errors.push({ message: ${msg}, path: ${at} })`,
      )
    }
  }

  if (checks.length === 0) return []
  return [`  for (const _name of Object.keys(${ctx.objVar})) {`, ...checks, `  }`]
}

/**
 * Emits `dependentRequired` checks: when a trigger key is present, each of its
 * declared dependencies must be present too. Reads the object and reports at the
 * current node via `ctx`, so it works at the root and inside nested objects.
 */
const generateDependentRequiredChecks = (schema: JSONSchema, ctx: NestingContext): string[] => {
  if (!isSchemaObject(schema) || !hasDependentRequired(schema)) return []
  const obj = ctx.objVar
  const at = ctx.depth === 0 ? '_path' : `\`${ctx.pathPrefix}\``
  const lines: string[] = []
  for (const [trigger, deps] of Object.entries(schema.dependentRequired)) {
    if (!Array.isArray(deps)) continue
    for (const dep of deps) {
      const msg = JSON.stringify(`must have property '${dep}' when '${trigger}' is present`)
      lines.push(`  if (${JSON.stringify(trigger)} in ${obj} && !(${JSON.stringify(dep)} in ${obj})) {`)
      lines.push(`    errors.push({ message: ${msg}, path: ${at} })`)
      lines.push(`  }`)
    }
  }
  return lines
}

/**
 * Builds the `&&` conditions that prove a single property is valid, or `null`
 * when the property carries any keyword the slow path enforces beyond a bare
 * type check (pattern, min/max, enum, const, `$ref`, items, x-mjst, …). A `null`
 * makes the whole guard bail so that input still flows through the slow,
 * error-collecting path — the guard only ever returns true for *provably* valid
 * input, never weakening a verdict. `objAcc` is the expression yielding the
 * parent object (already narrowed to a record); `key` indexes into it.
 */
const guardPropConditions = (key: string, propSchema: JSONSchema, objAcc: string): string[] | null => {
  if (!isSchemaObject(propSchema)) return null

  // Dotted access (`obj.number`) for identifier keys, bracket access otherwise.
  const raw = safeAccessor(objAcc, key)

  // Anything the slow path enforces past a typeof is cheaper to leave to the
  // slow path than to mirror here, so bail and keep the guard sound.
  if (
    hasRef(propSchema) ||
    hasEnum(propSchema) ||
    hasConst(propSchema) ||
    hasOneOf(propSchema) ||
    hasAnyOf(propSchema) ||
    hasAllOf(propSchema) ||
    'not' in propSchema ||
    'if' in propSchema ||
    getMjstInstanceOf(propSchema) !== undefined ||
    getMjstPrimitive(propSchema) !== undefined ||
    hasPattern(propSchema) ||
    hasMinLength(propSchema) ||
    hasMaxLength(propSchema) ||
    hasMinimum(propSchema) ||
    hasMaximum(propSchema) ||
    hasExclusiveMinimum(propSchema) ||
    hasExclusiveMaximum(propSchema) ||
    hasMultipleOf(propSchema) ||
    hasItems(propSchema)
  ) {
    return null
  }

  if (!hasType(propSchema)) return null

  switch (propSchema.type as string) {
    case 'string':
      return [`typeof ${raw} === 'string'`]
    case 'number':
      return [`typeof ${raw} === 'number'`]
    case 'integer':
      return [`typeof ${raw} === 'number'`, `Number.isInteger(${raw})`]
    case 'boolean':
      return [`typeof ${raw} === 'boolean'`]
    case 'null':
      return [`${raw} === null`]
    case 'object':
      // Member access into the nested record is only reached after the shape
      // check ahead of it in the `&&` chain, so the cast is always safe.
      return guardObjectConditions(propSchema, raw, `(${raw} as Record<string, unknown>)`)
    // Arrays need a per-item loop the guard can't express, and any other type
    // (null, multi-type, untyped) is left to the slow path.
    default:
      return null
  }
}

/** A property key an array carries with a non-`undefined` value: `length`, or a
 * canonical array index. A required prop on one of these can't be used to rule
 * out arrays (an array's `length` is a number, an index can be anything). */
const ARRAY_INDEX_KEY = /^(0|[1-9]\d*)$/

/** Schema types whose guard is a `typeof` check `typeof undefined` never passes. */
const TYPEOF_CHECKABLE_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object'])

/**
 * Whether some required, typeof-guarded property proves the value can't be an
 * array — letting the object shape-check drop its `!Array.isArray(...)` term. An
 * array indexed by a normal key yields `undefined` (or an inherited method),
 * which no `typeof === 'string' | 'number' | 'boolean' | 'object'` accepts, so
 * that field check already rejects arrays. Keys an array does carry a real value
 * for (`length`, numeric indices) are excluded, since those could slip through.
 */
const arrayRejectedByRequiredProp = (
  keys: string[],
  required: Set<string>,
  properties: Record<string, JSONSchema>,
): boolean => {
  for (const key of keys) {
    if (!required.has(key) || key === 'length' || ARRAY_INDEX_KEY.test(key)) continue
    const propSchema = properties[key]
    if (
      propSchema !== undefined &&
      isSchemaObject(propSchema) &&
      hasType(propSchema) &&
      TYPEOF_CHECKABLE_TYPES.has(propSchema.type as string)
    ) {
      return true
    }
  }
  return false
}

/**
 * Builds the allocation-free boolean guard for an object schema as a list of
 * `&&` conditions, or `null` when the schema can't be proven valid by a cheap
 * expression. The conditions are ordered so every member access is guarded by
 * the object-shape check that precedes it in the `&&` chain.
 *
 * The guard only handles the happy path: every declared property must be
 * required and a bare-typed scalar or a likewise-guardable nested object. Any
 * optional property, object-level constraint the slow path enforces
 * (`patternProperties`, `propertyNames`, `dependentRequired`, an
 * `additionalProperties` *schema*), or unguardable property makes it bail, and
 * the validator falls back to its full error-collecting body.
 */
const guardObjectConditions = (schema: JSONSchema, raw: string, objAcc: string): string[] | null => {
  if (!isObjectSchema(schema)) return null
  if (hasDependentRequired(schema) || hasPropertyNames(schema)) return null
  if (isSchemaObject(schema) && 'patternProperties' in schema) return null

  let strict = false
  if (hasAdditionalProperties(schema)) {
    // Only `additionalProperties: false` is guardable (via the key-count trick
    // below); an additional-properties *schema* needs per-key validation.
    if (schema.additionalProperties === false) strict = true
    else return null
  }

  const required = new Set(hasRequired(schema) ? schema.required : [])
  const properties = hasProperties(schema) ? schema.properties : {}
  const keys = Object.keys(properties)

  // A required key with no `properties` entry has no cheap guard condition, so
  // defer to the slow path (which checks its presence).
  for (const key of required) {
    if (!Object.hasOwn(properties, key)) return null
  }

  // The object shape-check only needs `!Array.isArray` when no required field
  // check would already reject an array (see `arrayRejectedByRequiredProp`).
  const arrayCheck = arrayRejectedByRequiredProp(keys, required, properties) ? '' : ` && !Array.isArray(${raw})`
  const conditions: string[] = [`typeof ${raw} === 'object' && ${raw} !== null${arrayCheck}`]

  for (const key of keys) {
    // An optional property would need an `=== undefined ||` branch and breaks
    // the key-count trick, so the guard only covers all-required objects.
    if (!required.has(key)) return null
    const propConditions = guardPropConditions(key, properties[key] as JSONSchema, objAcc)
    if (propConditions === null) return null
    conditions.push(...propConditions)
  }

  if (strict) {
    // `additionalProperties: false` with every declared property required: once
    // the typeof checks confirm each key is present, an exact key count proves
    // there are no extras — TypeBox's trick, with no loop and no Set.
    if (!keys.every((key) => required.has(key))) return null
    conditions.push(`Object.keys(${objAcc}).length === ${keys.length}`)
  }

  return conditions
}

/**
 * Generates a validator function body for an object schema, checking each
 * property's presence and type and collecting all errors.
 */
const generateObjectValidator = (schema: JSONSchema, typeName: string, suffix: string): string => {
  const vName = validatorName(typeName)
  const required = new Set(hasRequired(schema) ? schema.required : [])
  const properties = hasProperties(schema) ? schema.properties : {}
  const ctx = createRootContext()

  const propertyLines: string[] = []

  for (const [key, propSchema] of Object.entries(properties)) {
    const checks = generatePropertyChecks(key, propSchema as JSONSchema, required.has(key), suffix, ctx)
    if (checks.length > 0) {
      propertyLines.push(...checks)
    }
  }

  // Required keys with no `properties` entry still need a presence check.
  propertyLines.push(...generateMissingRequiredChecks(schema, ctx))

  // patternProperties values and a schema-form additionalProperties are
  // validated here (the `false` form is handled by generateStrictKeyChecks).
  propertyLines.push(...generatePatternAndAdditionalChecks(schema, suffix, ctx))

  // additionalProperties: false rejects every key not declared in properties
  propertyLines.push(...generateStrictKeyChecks(schema, ctx))

  // dependentRequired — when a trigger property is present, its dependencies must be too.
  propertyLines.push(...generateDependentRequiredChecks(schema, ctx))

  // propertyNames — every key (always a string) must satisfy the subschema. This
  // mirrors the interpreter, which runs the full subschema against each key.
  if (hasPropertyNames(schema) && isSchemaObject(schema.propertyNames)) {
    propertyLines.push(...generatePropertyNameChecks(schema.propertyNames, suffix, ctx))
  }

  // Combinators declared alongside the object's properties (e.g. an object with
  // `allOf` refining it further) are validated against the object value itself.
  propertyLines.push(...generateCombinatorChecks('', 'obj', '`${_path}`', schema, suffix, ctx))

  // Lazily allocate the errors array so a valid input never builds one — the same
  // allocation-free happy path the runtime interpreter uses. Each emitted
  // `errors.push(...)` becomes a create-on-first-use push; nothing is allocated
  // until the first actual error, so the common valid case stays alloc-free even
  // when the schema is too rich for the boolean guard.
  const body = (propertyLines.length > 0 ? '\n' + propertyLines.join('\n') + '\n' : '').replaceAll(
    'errors.push(',
    '(errors ??= []).push(',
  )

  // Hoisted statements (e.g. known-keys Sets) come first so every call of the
  // validator reuses them instead of rebuilding them.
  const hoistedBlock = ctx.hoisted.length > 0 ? `${ctx.hoisted.join('\n')}\n\n` : ''

  // A pure boolean guard for the happy path: when every property is present and
  // well-typed (and, for strict objects, there are no extras) it returns true
  // without allocating an `errors` array or touching the slow path. It returns
  // true only for provably valid input; anything it can't prove cheaply falls
  // through to the error-collecting path, which produces the same verdict and
  // full JSON-Pointer errors. Schemas with constraints the guard can't express
  // produce no guard at all (`null`), leaving behaviour unchanged.
  const guard = guardObjectConditions(schema, 'input', 'obj')

  // The cold, error-collecting body. When there's a guard this is a separate
  // (unexported) function reached only on failure; the hot path never enters it
  // unless input is actually invalid, so its size never costs the happy path.
  const collectBody = (name: string, exported: boolean): string =>
    [
      `${exported ? 'export ' : ''}const ${name} = (input: unknown, _path = ''): ValidationResult => {`,
      `  const obj = input as Record<string, unknown>`,
      `  if (typeof input !== 'object' || input === null || Array.isArray(input)) {`,
      `    return { valid: false, errors: [{ message: 'must be object', path: _path }] }`,
      `  }`,
      ``,
      `  let errors: ValidationError[] | undefined`,
      body,
      `  return errors !== undefined ? { valid: false, errors } : true`,
      `}`,
    ].join('\n')

  // No guard: the exported validator is the error-collecting function itself.
  if (!guard) {
    return `${hoistedBlock}${collectBody(vName, true)}`
  }

  // With a guard, keep the happy path inside the exported function — the guard
  // is inlined as an early `return true`, so a valid input never pays an extra
  // call — and move only the cold, error-collecting body into a separate
  // (unexported) function. That keeps `validateX` itself tiny (guard + a single
  // tail call) so V8 optimises it well, without the giant error body bloating
  // the hot path. The exported `(input, _path?) => ValidationResult` contract
  // is unchanged.
  const collectName = `${vName}Errors`
  return [
    `${hoistedBlock}${collectBody(collectName, false)}`,
    ``,
    `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
    `  const obj = input as Record<string, unknown>`,
    `  if (`,
    guard.map((condition) => `    ${condition}`).join(' &&\n'),
    `  ) {`,
    `    return true`,
    `  }`,
    `  return ${collectName}(input, _path)`,
    `}`,
  ].join('\n')
}

/**
 * Derives the boolean type-guard name from a type name.
 * e.g. "InfoObject" → "isInfoObject"
 */
const guardName = (typeName: string): string => `is${typeName}`

/**
 * Positive type check for a value — the negation of {@link wrongTypeCondition}.
 * Used by the boolean type-guard, which proves validity with `&&` conditions
 * rather than collecting errors. Object is a shape-only check (matching the
 * validator, which never recurses into array items or untyped object values).
 */
const rightTypeCondition = (accessor: string, type: string): string | null => {
  switch (type) {
    case 'string':
      return `typeof ${accessor} === 'string'`
    case 'number':
      return `typeof ${accessor} === 'number'`
    case 'integer':
      return `typeof ${accessor} === 'number' && Number.isInteger(${accessor})`
    case 'boolean':
      return `typeof ${accessor} === 'boolean'`
    case 'array':
      return `Array.isArray(${accessor})`
    case 'null':
      return `${accessor} === null`
    case 'object':
      return `typeof ${accessor} === 'object' && ${accessor} !== null && !Array.isArray(${accessor})`
    default:
      return null
  }
}

/**
 * Builds the membership test for an `enum`, matching the slow path's
 * `[...].includes(value)` verdict exactly. For the common all-primitive case it
 * emits a parenthesized `a === x || a === y` chain — no per-call array
 * allocation and no linear scan, so it stays on the allocation-free hot path —
 * and falls back to `.includes` when a member is an object/array (reference
 * equality) or `NaN` (where `includes`'s SameValueZero differs from `===`).
 */
const enumMembershipExpr = (values: unknown[], acc: string): string => {
  const allPrimitive =
    values.length > 0 &&
    values.every((v) => (v === null || typeof v !== 'object') && typeof v !== 'function') &&
    !values.some((v) => typeof v === 'number' && Number.isNaN(v))
  if (allPrimitive) {
    return `(${values.map((v) => `${acc} === ${JSON.stringify(v)}`).join(' || ')})`
  }
  return `(${JSON.stringify(values)} as unknown[]).includes(${acc})`
}

/**
 * Builds a boolean expression that is TRUE iff `acc` satisfies `schema`, with the
 * *exact same verdict* as the error-collecting validator — or `null` when the
 * schema carries something the flat form can't faithfully mirror ($ref, unions,
 * `const`, x-mjst, etc.), in which case the whole guard falls back to calling the
 * validator. Used for a property value or an array item; `acc` is the expression
 * yielding the value.
 */
const booleanLeafExpr = (schema: JSONSchema, acc: string): string | null => {
  if (!isSchemaObject(schema)) return null

  // Anything whose verdict the flat form can't mirror exactly: defer to the
  // validator (the caller turns a single `null` into a full fallback guard).
  if (
    hasRef(schema) ||
    hasConst(schema) ||
    hasOneOf(schema) ||
    'anyOf' in schema ||
    'allOf' in schema ||
    'not' in schema ||
    'if' in schema ||
    'contains' in schema ||
    'prefixItems' in schema ||
    getMjstInstanceOf(schema) !== undefined ||
    getMjstPrimitive(schema) !== undefined
  ) {
    return null
  }

  // enum — same membership test the validator uses.
  if (hasEnum(schema)) {
    return enumMembershipExpr(schema.enum as unknown[], acc)
  }

  if (!hasType(schema)) return null
  const t = schema.type as string

  switch (t) {
    // Each constraint is the exact negation of the validator's error condition
    // (`!(len < min)`, not `len >= min`) so edge values — most importantly `NaN`,
    // which the validator accepts for a constrained number since `NaN < min` is
    // false — get the identical verdict.
    case 'string': {
      const parts = [`typeof ${acc} === 'string'`]
      if (hasPattern(schema)) parts.push(`/${escapeRegexPattern(schema.pattern)}/.test(${acc})`)
      if (hasMinLength(schema)) parts.push(`!(${acc}.length < ${schema.minLength})`)
      if (hasMaxLength(schema)) parts.push(`!(${acc}.length > ${schema.maxLength})`)
      return parts.join(' && ')
    }
    case 'number':
    case 'integer': {
      const parts = [`typeof ${acc} === 'number'`]
      if (t === 'integer') parts.push(`Number.isInteger(${acc})`)
      if (hasMinimum(schema))
        parts.push(`!(${acc} ${hasStrictExclusiveMinimum(schema) ? '<=' : '<'} ${schema.minimum})`)
      if (hasMaximum(schema))
        parts.push(`!(${acc} ${hasStrictExclusiveMaximum(schema) ? '>=' : '>'} ${schema.maximum})`)
      if (hasExclusiveMinimum(schema)) parts.push(`!(${acc} <= ${schema.exclusiveMinimum})`)
      if (hasExclusiveMaximum(schema)) parts.push(`!(${acc} >= ${schema.exclusiveMaximum})`)
      if (hasMultipleOf(schema)) parts.push(`${acc} % ${schema.multipleOf} === 0`)
      return parts.join(' && ')
    }
    case 'boolean':
      return `typeof ${acc} === 'boolean'`
    case 'null':
      return `${acc} === null`
    case 'object': {
      const parts = booleanObjectParts(schema, acc, `(${acc} as Record<string, unknown>)`)
      return parts === null ? null : parts.join(' && ')
    }
    case 'array':
      return booleanArrayExpr(schema, acc)
    default:
      return null
  }
}

/**
 * Boolean expression for an array value. Mirrors the validator, which checks the
 * array shape and — for typed items — only each item's *type* (objects are shape-
 * checked, not recursed into); it never enforces `minItems`/`maxItems` or item
 * constraints. Returns `null` for `$ref` items (those defer to the validator).
 *
 * Item iteration goes through `Array.from` rather than `Array.prototype.every`
 * because `every` *skips holes* in a sparse array (`[, 'x']`), whereas the
 * validator's index-based `for` loop reads a hole as `undefined` and rejects it.
 * Materialising the array first makes the guard's verdict match the slow path's
 * on sparse input — the guard must never accept what the slow path would reject.
 */
const booleanArrayExpr = (schema: JSONSchema, acc: string): string | null => {
  const parts = [`Array.isArray(${acc})`]
  // Length / uniqueness, mirroring the validator's checks exactly so the guard's
  // verdict matches the slow path's.
  if (hasMinItems(schema)) parts.push(`${acc}.length >= ${schema.minItems}`)
  if (hasMaxItems(schema)) parts.push(`${acc}.length <= ${schema.maxItems}`)
  if (hasUniqueItems(schema) && schema.uniqueItems === true) {
    parts.push(`new Set((${acc} as unknown[]).map((_u) => JSON.stringify(_u))).size === ${acc}.length`)
  }
  const base = parts.join(' && ')

  if (!hasItems(schema)) return base
  const items = schema.items
  if (!isSchemaObject(items)) return base
  if (hasRef(items)) return null
  if (!hasType(items)) return base
  const itemCheck = rightTypeCondition('_it', items.type as string)
  if (itemCheck === null) return base
  return `${base} && Array.from(${acc} as unknown[]).every((_it) => ${itemCheck})`
}

/**
 * Builds the `&&` conditions proving an object value is valid (same verdict as
 * the error-collecting validator), or `null` when any property or object-level
 * keyword can't be mirrored flat. `raw` yields the value (for the shape check);
 * `objAcc` is the same value narrowed to a record (for member access).
 */
const booleanObjectParts = (schema: JSONSchema, raw: string, objAcc: string): string[] | null => {
  if (!isObjectSchema(schema)) return null
  // These need per-key loops or cross-references the flat form can't express.
  if (hasDependentRequired(schema) || hasPropertyNames(schema)) return null
  if (isSchemaObject(schema) && 'patternProperties' in schema) return null

  let strict = false
  if (hasAdditionalProperties(schema)) {
    // Only `additionalProperties: false` is expressible; a schema needs per-key
    // validation, so defer to the validator.
    if (schema.additionalProperties === false) strict = true
    else return null
  }

  const required = new Set(hasRequired(schema) ? schema.required : [])
  const properties = hasProperties(schema) ? schema.properties : {}
  const keys = Object.keys(properties)

  // Drop the `!Array.isArray` term when a required, typeof-guarded property
  // already rejects arrays (an array's normal key is `undefined`, which no
  // `typeof` accepts) — the same sound optimisation the validator's hot guard
  // uses. Kept when no such property exists.
  const arrayCheck = arrayRejectedByRequiredProp(keys, required, properties) ? '' : ` && !Array.isArray(${raw})`
  const parts: string[] = [`typeof ${raw} === 'object' && ${raw} !== null${arrayCheck}`]

  for (const key of keys) {
    const propSchema = properties[key]
    if (propSchema === undefined || !isSchemaObject(propSchema)) return null
    const member = safeAccessor(objAcc, key)
    const expr = booleanLeafExpr(propSchema, member)
    if (expr === null) return null
    parts.push(required.has(key) ? expr : `(${member} === undefined || (${expr}))`)
  }

  if (strict) {
    // `additionalProperties: false`: with every property required, an exact key
    // count proves no extras (the typeof checks above already proved presence);
    // otherwise sweep the keys against the declared set.
    if (keys.length === 0) {
      parts.push(`Object.keys(${objAcc}).length === 0`)
    } else if (keys.every((key) => required.has(key))) {
      parts.push(`Object.keys(${objAcc}).length === ${keys.length}`)
    } else {
      const known = keys.map((key) => `_k === ${JSON.stringify(key)}`).join(' || ')
      parts.push(`Object.keys(${objAcc}).every((_k) => ${known})`)
    }
  }

  return parts
}

/**
 * Generates the exported boolean type-guard `isTypeName(input): input is TypeName`.
 *
 * Unlike `validateTypeName` (which returns rich `ValidationResult` errors), this
 * is a single flat boolean predicate — no error array, no cold-path call — so V8
 * inlines it like a hand-written `check`, matching the shape of TypeBox's
 * compiled checker. It returns the *same verdict* as the validator. When the
 * schema carries anything the flat form can't mirror exactly, it falls back to
 * `validateTypeName(input) === true`, which is always correct.
 */
export const generateBooleanGuard = (schema: JSONSchema, typeName: string, _suffix = ''): string => {
  const name = guardName(typeName)
  const fallback = `export const ${name} = (input: unknown): input is ${typeName} => ${validatorName(typeName)}(input) === true`

  if (isObjectSchema(schema)) {
    const parts = booleanObjectParts(schema, 'input', 'obj')
    if (parts === null) return fallback
    return [
      `export const ${name} = (input: unknown): input is ${typeName} => {`,
      `  const obj = input as Record<string, unknown>`,
      `  return (`,
      parts.map((part) => `    ${part}`).join(' &&\n'),
      `  )`,
      `}`,
    ].join('\n')
  }

  // Non-object roots (scalar, enum, array) can often be expressed inline too.
  const expr = booleanLeafExpr(schema, 'input')
  if (expr === null) return fallback
  return `export const ${name} = (input: unknown): input is ${typeName} => ${expr}`
}

/**
 * Generates a validator function for a non-object schema (primitive, array, enum, $ref).
 */
const generateScalarValidator = (schema: JSONSchema, typeName: string, suffix: string): string => {
  const vName = validatorName(typeName)

  if (!isSchemaObject(schema)) {
    return [`export const ${vName} = (_input: unknown, _path = ''): ValidationResult => {`, `  return true`, `}`].join(
      '\n',
    )
  }

  // Top-level $ref — delegate entirely
  if (hasRef(schema)) {
    const delegateName = validatorName(refToName(schema.$ref, suffix))
    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  return ${delegateName}(input, _path)`,
      `}`,
    ].join('\n')
  }

  // Top-level x-mjst instanceOf (e.g. a schema that is itself a Date)
  const instanceOf = getMjstInstanceOf(schema)
  if (instanceOf) {
    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  if (!(input instanceof ${instanceOf})) {`,
      `    return { valid: false, errors: [{ message: 'must be ${instanceOf}', path: _path }] }`,
      `  }`,
      `  return true`,
      `}`,
    ].join('\n')
  }

  // Top-level x-mjst primitive (e.g. a schema that is itself a bigint)
  const primitive = getMjstPrimitive(schema)
  if (primitive) {
    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  if (typeof input !== "${primitive}") {`,
      `    return { valid: false, errors: [{ message: 'must be ${primitive}', path: _path }] }`,
      `  }`,
      `  return true`,
      `}`,
    ].join('\n')
  }

  // Top-level const
  if (hasConst(schema)) {
    const mismatch = constMismatchCondition('input', schema.const)
    const msg = JSON.stringify(`must be ${JSON.stringify(schema.const)}`)
    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  if (${mismatch}) {`,
      `    return { valid: false, errors: [{ message: ${msg}, path: _path }] }`,
      `  }`,
      `  return true`,
      `}`,
    ].join('\n')
  }

  // Top-level enum
  if (hasEnum(schema)) {
    const allowed = JSON.stringify(schema.enum)
    const label = (schema.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')
    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  if (!(${allowed} as unknown[]).includes(input)) {`,
      `    return { valid: false, errors: [{ message: ${JSON.stringify(`must be one of: ${label}`)}, path: _path }] }`,
      `  }`,
      `  return true`,
      `}`,
    ].join('\n')
  }

  // oneOf — try each branch, return errors from all if none match
  // Top-level combinators (`allOf` / `anyOf` / `oneOf` / `not` / `if`), validated
  // against the input via the shared combinator generator — correct `oneOf`
  // (exactly one) and inline branches included, not just `$ref` branches.
  if (hasAllOf(schema) || hasAnyOf(schema) || hasOneOf(schema) || 'not' in schema || 'if' in schema) {
    const ctx = createRootContext()
    const checks = generateCombinatorChecks('', 'input', '`${_path}`', schema, suffix, ctx)
    const body = checks.join('\n').replaceAll('errors.push(', '(errors ??= []).push(')
    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  let errors: ValidationError[] | undefined`,
      body,
      `  return errors !== undefined ? { valid: false, errors } : true`,
      `}`,
    ].join('\n')
  }

  // Top-level typed schema (string, number, boolean, array)
  if (hasType(schema)) {
    const t = schema.type as string
    const wrongType = wrongTypeCondition('input', t)
    const typLabel = typeofString(t)

    const constraintLines: string[] = []

    if (t === 'string') {
      if (hasPattern(schema)) {
        const re = escapeRegexPattern(schema.pattern)
        const msg = JSON.stringify(`must match pattern ${schema.pattern}`)
        constraintLines.push(`  if (typeof input === 'string' && !/${re}/.test(input)) {`)
        constraintLines.push(`    errors.push({ message: ${msg}, path: _path })`)
        constraintLines.push(`  }`)
      }
      if (hasMinLength(schema)) {
        constraintLines.push(`  if (typeof input === 'string' && input.length < ${schema.minLength}) {`)
        constraintLines.push(
          `    errors.push({ message: 'must have at least ${schema.minLength} characters', path: _path })`,
        )
        constraintLines.push(`  }`)
      }
      if (hasMaxLength(schema)) {
        constraintLines.push(`  if (typeof input === 'string' && input.length > ${schema.maxLength}) {`)
        constraintLines.push(
          `    errors.push({ message: 'must have at most ${schema.maxLength} characters', path: _path })`,
        )
        constraintLines.push(`  }`)
      }
    }

    if (!wrongType) {
      return [
        `export const ${vName} = (_input: unknown, _path = ''): ValidationResult => {`,
        `  return true`,
        `}`,
      ].join('\n')
    }

    if (constraintLines.length === 0) {
      return [
        `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
        `  if (${wrongType}) {`,
        `    return { valid: false, errors: [{ message: 'must be ${typLabel}', path: _path }] }`,
        `  }`,
        `  return true`,
        `}`,
      ].join('\n')
    }

    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  if (${wrongType}) {`,
      `    return { valid: false, errors: [{ message: 'must be ${typLabel}', path: _path }] }`,
      `  }`,
      `  let errors: ValidationError[] | undefined`,
      constraintLines.join('\n').replaceAll('errors.push(', '(errors ??= []).push('),
      `  return errors !== undefined ? { valid: false, errors } : true`,
      `}`,
    ].join('\n')
  }

  return [`export const ${vName} = (_input: unknown, _path = ''): ValidationResult => {`, `  return true`, `}`].join(
    '\n',
  )
}

/**
 * Generates a TypeScript validator function from a JSON Schema.
 *
 * The generated function accepts `unknown` input and returns `true` if valid,
 * or `{ valid: false, errors }` with a list of errors if not.
 *
 * Object schemas check that required properties are present and that all
 * provided properties match their declared types. Non-object schemas (strings,
 * numbers, enums, $refs) emit an inline type check.
 *
 * @example
 * ```typescript
 * generateValidatorFunction({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, 'Info')
 * // export const validateInfo = (input: unknown, _path = ''): ValidationResult => {
 * //   if (typeof input !== 'object' || ...) return { valid: false, ... }
 * //   const errors: ValidationError[] = []
 * //   const obj = input as Record<string, unknown>
 * //   if (!('name' in obj)) { errors.push(...) } else if (typeof obj['name'] !== 'string') { errors.push(...) }
 * //   return errors.length > 0 ? { valid: false, errors } : true
 * // }
 * ```
 */
export const generateValidatorFunction = (schema: JSONSchema, typeName: string, suffix = ''): string => {
  if (isObjectSchema(schema)) {
    return generateObjectValidator(schema, typeName, suffix)
  }

  return generateScalarValidator(schema, typeName, suffix)
}
