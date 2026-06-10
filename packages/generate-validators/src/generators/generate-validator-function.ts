import { escapeRegexPattern } from '@amritk/helpers/escape-regex-pattern'
import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import { refToName } from '@amritk/helpers/ref-to-name'
import {
  hasAdditionalProperties,
  hasConst,
  hasDependentRequired,
  hasEnum,
  hasExclusiveMaximum,
  hasExclusiveMinimum,
  hasItems,
  hasMaximum,
  hasMaxLength,
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
  isObjectSchema,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
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
    case 'integer':
      return `typeof ${accessor} !== 'number'`
    case 'boolean':
      return `typeof ${accessor} !== 'boolean'`
    case 'array':
      return `!Array.isArray(${accessor})`
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
 * Up to this many known keys, the unknown-key sweep tests each key against an
 * inline chain of `!==` string comparisons rather than a hoisted `Set`. V8
 * evaluates a short comparison chain faster than `Set.has` (which has to hash
 * the string) for small key counts — the same shape Ajv and TypeBox compile to
 * — and it skips the per-module `Set` allocation. Above the threshold the chain
 * grows long enough that the `Set`'s O(1) lookup wins, so we fall back to it.
 */
const STRICT_INLINE_KEY_LIMIT = 16

/**
 * Generates the unknown-key sweep for `additionalProperties: false`, mirroring
 * the interpreter's behaviour (same error message, one error per extra key).
 * The sweep uses `for...in` — the same allocation-free shape Ajv compiles to.
 * For a small number of known keys it inlines a chain of `!==` comparisons
 * (faster than `Set.has` and allocation-free, see {@link STRICT_INLINE_KEY_LIMIT});
 * beyond that it hoists a known-keys `Set` to module scope and tests with one
 * lookup per key. Schemas that combine it with `patternProperties` are skipped:
 * the generator does not evaluate key patterns yet, so rejecting every
 * undeclared key would wrongly fail keys the patterns allow.
 */
const generateStrictKeyChecks = (schema: JSONSchema, ctx: NestingContext): string[] => {
  if (!isSchemaObject(schema)) return []
  if (!hasAdditionalProperties(schema) || schema.additionalProperties !== false) return []
  if ('patternProperties' in schema) return []

  const known = Object.keys(hasProperties(schema) ? schema.properties : {})
  const d = ctx.depth

  // True when `_key${d}` is not one of the declared properties. With no declared
  // properties every key is additional; a short list inlines comparisons; a long
  // one falls back to a hoisted Set.
  let unknownKeyCondition: string
  if (known.length === 0) {
    unknownKeyCondition = 'true'
  } else if (known.length <= STRICT_INLINE_KEY_LIMIT) {
    unknownKeyCondition = known.map((key) => `_key${d} !== ${JSON.stringify(key)}`).join(' && ')
  } else {
    const setName = `_knownKeys${ctx.hoisted.length}`
    ctx.hoisted.push(`const ${setName} = new Set(${JSON.stringify(known)})`)
    unknownKeyCondition = `!${setName}.has(_key${d})`
  }

  return [
    `  for (const _key${d} in ${ctx.objVar}) {`,
    `    if (${unknownKeyCondition}) {`,
    `      errors.push({ message: 'must NOT have additional properties', path: \`${ctx.pathPrefix}/\${_key${d}}\` })`,
    `    }`,
    `  }`,
  ]
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
      lines.push(`    errors.push({ message: "must have required property '${key}'", path: ${parentPath} })`)
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
      lines.push(`    errors.push({ message: "must have required property '${key}'", path: ${parentPath} })`)
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
      lines.push(`    errors.push({ message: "must have required property '${key}'", path: ${parentPath} })`)
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
      lines.push(`    errors.push({ message: "must have required property '${key}'", path: ${parentPath} })`)
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
      lines.push(`    errors.push({ message: "must have required property '${key}'", path: ${parentPath} })`)
      lines.push(`  } else if (!(${allowed} as unknown[]).includes(${raw})) {`)
      lines.push(`    errors.push({ message: \`must be one of: ${label}\`, path: ${path} })`)
      lines.push(`  }`)
    } else {
      lines.push(`  if (${raw} !== undefined && !(${allowed} as unknown[]).includes(${raw})) {`)
      lines.push(`    errors.push({ message: \`must be one of: ${label}\`, path: ${path} })`)
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
      lines.push(`    errors.push({ message: "must have required property '${key}'", path: ${parentPath} })`)
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

    // String constraints
    if (t === 'string') {
      if (hasPattern(propSchema)) {
        const re = escapeRegexPattern(propSchema.pattern)
        const msg = JSON.stringify(`must match pattern ${propSchema.pattern}`)
        lines.push(`  if (typeof ${raw} === 'string' && !/${re}/.test(${raw})) {`)
        lines.push(`    errors.push({ message: ${msg}, path: ${path} })`)
        lines.push(`  }`)
      }
      if (hasMinLength(propSchema)) {
        lines.push(`  if (typeof ${raw} === 'string' && ${raw}.length < ${propSchema.minLength}) {`)
        lines.push(
          `    errors.push({ message: 'must have at least ${propSchema.minLength} characters', path: ${path} })`,
        )
        lines.push(`  }`)
      }
      if (hasMaxLength(propSchema)) {
        lines.push(`  if (typeof ${raw} === 'string' && ${raw}.length > ${propSchema.maxLength}) {`)
        lines.push(
          `    errors.push({ message: 'must have at most ${propSchema.maxLength} characters', path: ${path} })`,
        )
        lines.push(`  }`)
      }
    }

    // Number constraints
    if (t === 'number' || t === 'integer') {
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
    if (t === 'array' && hasItems(propSchema)) {
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

    // Inline nested object — recurse so the nested fields are actually
    // validated. Without this only the "must be object" shape check above
    // runs and everything inside the nested object silently passes.
    if (t === 'object') {
      lines.push(...generateInlineObjectChecks(key, propSchema, raw, suffix, ctx))
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

  innerLines.push(...generateStrictKeyChecks(propSchema, child))

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
const generatePropertyNameChecks = (nameSchema: JSONSchema, suffix: string): string[] => {
  if (!isSchemaObject(nameSchema)) return []

  const at = '`${_path}/${_name}`'
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
  return [`  for (const _name of Object.keys(obj)) {`, ...checks, `  }`]
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

  // additionalProperties with a $ref schema validates all extra keys
  if (
    hasAdditionalProperties(schema) &&
    isSchemaObject(schema.additionalProperties) &&
    hasRef(schema.additionalProperties)
  ) {
    const vRefName = validatorName(refToName(schema.additionalProperties.$ref, suffix))
    propertyLines.push(`  for (const _key of Object.keys(obj)) {`)
    propertyLines.push(`    if (${JSON.stringify(Object.keys(properties))}.includes(_key)) continue`)
    propertyLines.push(`    const _r = ${vRefName}(obj[_key as keyof typeof obj], \`\${_path}/\${_key}\`)`)
    propertyLines.push(`    if (_r !== true) errors.push(..._r.errors)`)
    propertyLines.push(`  }`)
  }

  // additionalProperties: false rejects every key not declared in properties
  propertyLines.push(...generateStrictKeyChecks(schema, ctx))

  // dependentRequired — when a trigger property is present, its dependencies must be too.
  if (hasDependentRequired(schema)) {
    for (const [trigger, deps] of Object.entries(schema.dependentRequired)) {
      if (!Array.isArray(deps)) continue
      for (const dep of deps) {
        const msg = JSON.stringify(`must have property '${dep}' when '${trigger}' is present`)
        propertyLines.push(`  if (${JSON.stringify(trigger)} in obj && !(${JSON.stringify(dep)} in obj)) {`)
        propertyLines.push(`    errors.push({ message: ${msg}, path: _path })`)
        propertyLines.push(`  }`)
      }
    }
  }

  // propertyNames — every key (always a string) must satisfy the subschema. This
  // mirrors the interpreter, which runs the full subschema against each key.
  if (hasPropertyNames(schema) && isSchemaObject(schema.propertyNames)) {
    propertyLines.push(...generatePropertyNameChecks(schema.propertyNames, suffix))
  }

  const body = propertyLines.length > 0 ? '\n' + propertyLines.join('\n') + '\n' : ''

  // Hoisted statements (e.g. known-keys Sets) come first so every call of the
  // validator reuses them instead of rebuilding them.
  const hoistedBlock = ctx.hoisted.length > 0 ? `${ctx.hoisted.join('\n')}\n\n` : ''

  return [
    `${hoistedBlock}export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
    `  if (typeof input !== 'object' || input === null || Array.isArray(input)) {`,
    `    return { valid: false, errors: [{ message: 'must be object', path: _path }] }`,
    `  }`,
    ``,
    `  const errors: ValidationError[] = []`,
    `  const obj = input as Record<string, unknown>`,
    body,
    `  return errors.length > 0 ? { valid: false, errors } : true`,
    `}`,
  ].join('\n')
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
      `    return { valid: false, errors: [{ message: \`must be one of: ${label}\`, path: _path }] }`,
      `  }`,
      `  return true`,
      `}`,
    ].join('\n')
  }

  // oneOf — try each branch, return errors from all if none match
  if (hasOneOf(schema)) {
    const branches = schema.oneOf
      .map((branch, i) => {
        if (!hasRef(branch)) return null
        const bName = validatorName(refToName((branch as { $ref: string }).$ref, suffix))
        return `  const _r${i} = ${bName}(input, _path)\n  if (_r${i} === true) return true`
      })
      .filter(Boolean)
      .join('\n')

    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      branches,
      `  return { valid: false, errors: [{ message: 'must match one of the expected schemas', path: _path }] }`,
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
      `  const errors: ValidationError[] = []`,
      constraintLines.join('\n'),
      `  return errors.length > 0 ? { valid: false, errors } : true`,
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
