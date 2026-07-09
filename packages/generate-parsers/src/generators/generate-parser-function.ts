import { escapeRegexPattern } from '@amritk/helpers/escape-regex-pattern'
import { quoteJsString } from '@amritk/helpers/quote-js-string'
import { refToName } from '@amritk/helpers/ref-to-name'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import { safeAccessor, safeKey } from '@amritk/helpers/safe-accessor'
import {
  hasAdditionalProperties,
  hasAllOf,
  hasAnyOf,
  hasConst,
  hasEnum,
  hasItems,
  hasOneOf,
  hasProperties,
  hasRef,
  hasRequired,
  hasType,
  isObjectSchema,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import { unknownKeyCheck } from '@amritk/helpers/unknown-key-check'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { findDiscriminator } from '#helpers/find-discriminator'
import { getDefaultValue } from '#helpers/get-default-value'
import { getDiscriminatorValue } from '#helpers/get-discriminator-value'

import { generateEnumCaseInsensitiveCoercion } from './generate-enum-check'
import { generateObjectStrictAssertion, generateScalarStrictAssertion } from './generate-strict-assertion'
import {
  canEnforceUnion,
  generatePropertyTypeCheck,
  generateUnionCheck,
  getUnionBranches,
  isInlineObjectArrayProperty,
  isInlineObjectProperty,
  shapeValidatorName,
} from './generate-type-checks'
import { generateValidationExpression, isCoercibleItemSchema } from './generate-validation-expression'

/**
 * Options for controlling parser function generation behavior.
 */
type GenerateParserOptions = {
  /**
   * When true, properties with $ref will call the imported parser function
   * instead of inlining the validation logic. This is used when generating
   * files where each ref has its own separate file with a parser.
   */
  readonly useRefImports?: boolean
  /**
   * When true, the generated parser emits a console.warn for every input key
   * that is not declared in the schema's properties.
   */
  readonly logWarnings?: boolean
  /**
   * When true, the generated parser throws on type/shape mismatches instead
   * of coercing invalid input to default values. Throws on the first violation
   * with a path-aware Error. When the schema sets `additionalProperties: false`,
   * undeclared keys throw too; otherwise they are still allowed.
   */
  readonly strict?: boolean
  /**
   * When true, the generated parser builds its result from the schema's declared
   * properties only, silently dropping any undeclared input key at every nesting
   * level (zod's `.strip()`). Unlike `additionalProperties: false`, extras are
   * never a validation error — this composes with `strict`: `strict + stripUnknown`
   * still throws on wrong types and missing required properties but strips extras
   * instead of throwing on them. When the schema *also* sets
   * `additionalProperties: false`, rejecting wins over stripping in strict mode.
   */
  readonly stripUnknown?: boolean
  /**
   * Suffix appended to every type/parser name derived from a `$ref`. Must match
   * the suffix used when generating the referenced files. Defaults to `''`.
   */
  readonly typeSuffix?: string
  /**
   * The root schema document. When present, a top-level `oneOf`/`anyOf` whose
   * branches are `$ref`s can be resolved to find a shared discriminator and emit a
   * dispatch to the branch parsers, instead of falling back to a passthrough cast.
   */
  readonly rootSchema?: Record<string, unknown>
  /**
   * Type names the generated file imports for its `$ref`s. Synthesized private
   * sub-type names (nested objects, array items, the root array's `{Type}Item`)
   * dedup against this set so they can never shadow an imported identifier —
   * which would both fail to compile (duplicate declaration) and silently
   * validate against the wrong schema.
   */
  readonly reservedNames?: ReadonlySet<string>
  /**
   * True when this schema is the root document (not a `$ref`-reached definition).
   * The root type name is user-derived (schema `title`, filename, or `--root-type`),
   * so the JSON Schema meta-schema special case — keyed on the literal name
   * `Schema` — must not apply to it, or a common `schema.json` root would silently
   * generate a validation-free pass-through parser.
   */
  readonly isRoot?: boolean
  /**
   * When true, a mis-cased string that matches a declared `enum`/`const` member
   * case-insensitively is normalized to that member's exact casing (e.g. `hElLo`
   * → `hello`) instead of coercing to the default. Coerce mode only — strict
   * parsers still reject a casing mismatch. The normalization lives on the
   * failure branch of the coercion ternary, so a correctly-cased value keeps the
   * exact `===` fast path and the hot path is unaffected.
   */
  readonly caseInsensitive?: boolean
}

/**
 * Represents a property in the generated object literal.
 */
type PropertyEntry = {
  readonly key: string
  readonly value: string
  readonly isOptional: boolean
}

/**
 * Generates the parser function name from a type name.
 * Converts "UserObject" to "parseUserObject".
 */
const generateParserName = (typeName: string): string => {
  return `parse${typeName}`
}

/**
 * Checks if a property is required based on the schema's required array.
 */
const isPropertyRequired = (key: string, schema: JSONSchema): boolean => {
  if (!isSchemaObject(schema)) {
    return false
  }
  if (!('required' in schema) || !Array.isArray(schema.required)) {
    return false
  }
  return schema.required.includes(key)
}

/**
 * Generates a parser call expression for a required $ref property.
 * Example: parseContact(input.contact)
 */
const generateRequiredRefCall = (key: string, ref: string, suffix: string): string => {
  const acc = safeAccessor('input', key)
  const parserName = generateParserName(refToName(ref, suffix))
  return `${parserName}(${acc})`
}

/**
 * Generates a parser call expression for an optional $ref property.
 * Example: ...(input.contact && { contact: parseContact(input.contact) })
 */
const generateOptionalRefCall = (key: string, ref: string, suffix: string): string => {
  const acc = safeAccessor('input', key)
  const parserName = generateParserName(refToName(ref, suffix))
  // Gate on presence, not truthiness: a `&&` guard skips parsing when the value
  // is `false`/`0`/`""`/`null`, spreading it raw. `!== undefined` still omits an
  // absent optional property but coerces every present one, matching the main path.
  return `...(${acc} !== undefined && { ${safeKey(key)}: ${parserName}(${acc}) })`
}

/**
 * Generates a validateArray call for required array properties with $ref items.
 * Example: validateArray(input.contacts, parseContact)
 */
const generateRequiredArrayRefCall = (key: string, ref: string, suffix: string): string => {
  const parserName = generateParserName(refToName(ref, suffix))
  return `validateArray(${safeAccessor('input', key)}, ${parserName})`
}

/**
 * Generates a validateArray call for optional array properties with $ref items.
 * Example: ...(input.contacts && { contacts: validateArray(input.contacts, parseContact) })
 */
const generateOptionalArrayRefCall = (key: string, ref: string, suffix: string): string => {
  const parserName = generateParserName(refToName(ref, suffix))
  const acc = safeAccessor('input', key)
  // Presence gating (not truthiness) so a falsy-but-present value is still parsed.
  return `...(${acc} !== undefined && { ${safeKey(key)}: validateArray(${acc}, ${parserName}) })`
}

/**
 * Generates a validateRecord call for required object properties with additionalProperties $ref.
 * Example: validateRecord(input.responses, parseResponse)
 */
const generateRequiredRecordRefCall = (key: string, ref: string, suffix: string): string => {
  const acc = safeAccessor('input', key)
  const parserName = generateParserName(refToName(ref, suffix))
  return `validateRecord(${acc}, ${parserName})`
}

/**
 * Generates a validateRecord call for optional object properties with additionalProperties $ref.
 * Example: ...(input.responses && { responses: validateRecord(input.responses, parseResponse) })
 */
const generateOptionalRecordRefCall = (key: string, ref: string, suffix: string): string => {
  const acc = safeAccessor('input', key)
  const parserName = generateParserName(refToName(ref, suffix))
  // Presence gating (not truthiness) so a falsy-but-present value is still parsed.
  return `...(${acc} !== undefined && { ${safeKey(key)}: validateRecord(${acc}, ${parserName}) })`
}

/**
 * Generates a spread entry for optional inline properties.
 * The value expression is evaluated once and omitted when undefined.
 */
const generateOptionalInlineProperty = (key: string, valueExpression: string): string => {
  return `...((value => value === undefined ? {} : { ${safeKey(key)}: value })(${valueExpression}))`
}

/**
 * Determines if a property schema should use ref imports for validation.
 */
const shouldUseRefImport = (propSchema: JSONSchema, useRefImports: boolean): boolean => {
  if (!useRefImports || !hasRef(propSchema)) {
    return false
  }

  const ref = (propSchema as { $ref: string }).$ref
  // Skip external URI refs with property/definition fragments — these are not generated as files
  const isUri = ref.startsWith('http://') || ref.startsWith('https://')
  if (isUri && (ref.includes('#/properties/') || ref.includes('#/definitions/'))) {
    return false
  }

  return true
}

/**
 * Determines if an array property should use ref imports for its items.
 */
const shouldUseArrayRefImport = (propSchema: JSONSchema, useRefImports: boolean): boolean => {
  if (!useRefImports) {
    return false
  }
  if (!isSchemaObject(propSchema)) {
    return false
  }
  if (!('type' in propSchema) || propSchema.type !== 'array') {
    return false
  }
  return hasItems(propSchema) && hasRef(propSchema.items)
}

/**
 * Determines if a property with additionalProperties should use ref imports.
 */
const shouldUseRecordRefImport = (propSchema: JSONSchema, useRefImports: boolean): boolean => {
  if (!useRefImports) {
    return false
  }
  if (!isSchemaObject(propSchema)) {
    return false
  }
  if (!('type' in propSchema) || propSchema.type !== 'object') {
    return false
  }
  if (!('additionalProperties' in propSchema)) {
    return false
  }
  const additionalProps = propSchema.additionalProperties
  return isSchemaObject(additionalProps) && hasRef(additionalProps)
}

/**
 * Generates the value expression for a property based on its schema and options.
 */
const generatePropertyValue = (
  key: string,
  propSchema: JSONSchema,
  isRequired: boolean,
  useRefImports: boolean,
  suffix: string,
  caseInsensitive = false,
): string => {
  // Handle direct $ref properties
  if (shouldUseRefImport(propSchema, useRefImports)) {
    const ref = (propSchema as { $ref: string }).$ref
    return isRequired ? generateRequiredRefCall(key, ref, suffix) : generateOptionalRefCall(key, ref, suffix)
  }

  // Handle array properties with $ref items
  if (shouldUseArrayRefImport(propSchema, useRefImports)) {
    const items = (propSchema as { items: { $ref: string } }).items
    const ref = items.$ref
    return isRequired ? generateRequiredArrayRefCall(key, ref, suffix) : generateOptionalArrayRefCall(key, ref, suffix)
  }

  // Handle object properties with additionalProperties $ref
  if (shouldUseRecordRefImport(propSchema, useRefImports)) {
    const additionalProps = (propSchema as { additionalProperties: { $ref: string } }).additionalProperties
    const ref = additionalProps.$ref
    return isRequired
      ? generateRequiredRecordRefCall(key, ref, suffix)
      : generateOptionalRecordRefCall(key, ref, suffix)
  }

  // Handle non-schema object properties (true/false)
  if (!isSchemaObject(propSchema)) {
    return isRequired ? 'undefined' : generateOptionalInlineProperty(key, 'undefined')
  }

  // Generate standard validation expression
  const defaultValue = getDefaultValue(propSchema)
  const valueExpression = generateValidationExpression(
    key,
    propSchema,
    defaultValue,
    isRequired,
    undefined,
    undefined,
    undefined,
    undefined,
    caseInsensitive,
  )
  return isRequired ? valueExpression : generateOptionalInlineProperty(key, valueExpression)
}

/**
 * Generates property entries for all properties in the schema.
 */
const generatePropertyEntries = (
  schema: JSONSchema,
  useRefImports: boolean,
  suffix: string,
  caseInsensitive = false,
): PropertyEntry[] => {
  if (!hasProperties(schema)) {
    return []
  }

  const entries: PropertyEntry[] = []

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const isRequired = isPropertyRequired(key, schema)
    const value = generatePropertyValue(key, propSchema, isRequired, useRefImports, suffix, caseInsensitive)

    // Determine if the property uses spread syntax (making it optional in the object literal)
    const isOptional = value.startsWith('...')

    entries.push({ key, value, isOptional })
  }

  return entries
}

/**
 * Generates a fallback value for a required property.
 * This returns simple type-based defaults without pattern inference,
 * matching TypeBox's coercion behavior.
 */
const generateFallbackValue = (_: string, propSchema: JSONSchema, useRefImports: boolean, suffix: string): string => {
  // Handle direct $ref properties - call the parser with undefined
  if (useRefImports && hasRef(propSchema)) {
    const ref = (propSchema as { $ref: string }).$ref
    const parserName = generateParserName(refToName(ref, suffix))
    return `${parserName}(undefined)`
  }

  // Handle array properties with $ref items
  if (
    useRefImports &&
    isSchemaObject(propSchema) &&
    propSchema.type === 'array' &&
    hasItems(propSchema) &&
    hasRef(propSchema.items)
  ) {
    return '[]'
  }

  // Handle object properties with additionalProperties $ref
  if (
    useRefImports &&
    isSchemaObject(propSchema) &&
    propSchema.type === 'object' &&
    'additionalProperties' in propSchema
  ) {
    const additionalProps = propSchema.additionalProperties
    if (isSchemaObject(additionalProps) && hasRef(additionalProps)) {
      return '{}'
    }
  }

  // Everything else (default/const/enum/examples/union, the null type, and a
  // recursively-defaulted object) shares one source of truth so the fallback
  // object is itself a valid instance — `getDefaultValue` handles them all.
  return getDefaultValue(propSchema)
}

/**
 * Generates a fallback object with required properties filled with default values.
 * This is used when input is not an object (undefined, null, etc.).
 */
const generateFallbackObject = (
  schema: JSONSchema,
  useRefImports: boolean,
  typeName: string,
  suffix: string,
  subTypeNames?: Map<string, string>,
): string => {
  if (!hasProperties(schema)) {
    return `{} as ${typeName}`
  }

  // For schemas with conditional branches (if/then/else), the merged properties
  // may not fully represent all required fields. Use a simple cast to avoid
  // generating incomplete fallback objects.
  if (isSchemaObject(schema) && ('if' in schema || 'then' in schema || 'else' in schema)) {
    return `{} as ${typeName}`
  }

  const requiredProps: string[] = []

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const isRequired = isPropertyRequired(key, schema)
    if (isRequired) {
      // Inline nested objects delegate to their sub-parser so the fallback
      // carries proper deep defaults instead of an empty object literal.
      const subName = subTypeNames?.get(key)
      const fallbackValue = subName
        ? `${generateParserName(subName)}(undefined)`
        : generateFallbackValue(key, propSchema, useRefImports, suffix)
      if (fallbackValue === 'undefined') {
        return `{} as ${typeName}`
      }
      requiredProps.push(`        ${safeKey(key)}: ${fallbackValue},`)
    }
  }

  if (requiredProps.length === 0) {
    return `{} as ${typeName}`
  }

  let result = '{\n'
  for (let i = 0; i < requiredProps.length; i++) {
    result += requiredProps[i]
    if (i < requiredProps.length - 1) {
      result += '\n'
    }
  }
  result += '\n      }'
  return result
}

/**
 * Generates a parser for non-object schemas (string, number, boolean, array, etc.)
 * that validates the input matches the expected primitive type before casting.
 */
/**
 * A default value literal (as source text) for `schema`, used as the fallback a
 * top-level union coerces an unmatched value to. Prefers a `const`/`enum` member,
 * then a per-type empty value.
 */
const scalarDefaultLiteral = (schema: JSONSchema): string => {
  if (!isSchemaObject(schema)) return '{}'
  if (hasConst(schema)) return JSON.stringify(schema.const)
  if (hasEnum(schema) && schema.enum.length > 0) return JSON.stringify(schema.enum[0])
  if (hasType(schema)) {
    switch (schema.type) {
      case 'string':
        return '""'
      case 'number':
      case 'integer':
        return '0'
      case 'boolean':
        return 'false'
      case 'null':
        return 'null'
      case 'array':
        return '[]'
      case 'object':
        return '{}'
    }
  }
  return '{}'
}

/**
 * Context a top-level union parser needs to dispatch to `$ref` branch parsers:
 * whether ref branches are imported as parser functions, the type-name suffix,
 * and the root document to resolve branch refs against.
 */
type UnionParserContext = {
  readonly useRefImports: boolean
  readonly suffix: string
  readonly rootSchema?: Record<string, unknown>
  /** Forwarded to sub-parsers (e.g. a root array's item parser) so unknown-key warnings behave the same at every level. */
  readonly logWarnings?: boolean
  /** See GenerateParserOptions.reservedNames. */
  readonly reservedNames?: ReadonlySet<string>
  /**
   * Mirrors the parser's stripUnknown option. Strict union *enforcement* is
   * skipped when stripping: imported shape validators then treat undeclared
   * keys as a mismatch, but the stripUnknown contract is to drop extras, not
   * reject the value — throwing on that predicate would be wrong.
   */
  readonly stripUnknown?: boolean
  /** See GenerateParserOptions.caseInsensitive. */
  readonly caseInsensitive?: boolean
}

/**
 * Emits a dispatcher for a top-level `oneOf`/`anyOf` whose branches are `$ref`s,
 * when the branches share a discriminator (a `const`/`enum` tag such as `kind`).
 * Each resolved branch's discriminant selects its imported parser, so a recursive
 * discriminated union (e.g. `Expr = Lit | BinOp`, where `BinOp` has `Expr`
 * children) is actually validated and dispatched instead of blindly cast. Returns
 * `null` when it can't be done (no root schema, no discriminator, a non-ref
 * branch, or ref imports disabled), so the caller keeps its passthrough fallback.
 */
const generateRefUnionDispatch = (
  functionName: string,
  typeName: string,
  branches: readonly JSONSchema[],
  strict: boolean | undefined,
  ctx: UnionParserContext,
): string | null => {
  const rootSchema = ctx.rootSchema
  if (!ctx.useRefImports || rootSchema === undefined) return null
  if (branches.length === 0 || !branches.every((b) => isSchemaObject(b) && hasRef(b))) return null

  // Resolve each branch ref so we can read its discriminant tag and derive its
  // imported parser name.
  const resolved = branches.map((b) => {
    const ref = (b as { $ref: string }).$ref
    return { parser: generateParserName(refToName(ref, ctx.suffix)), schema: resolveRef(ref, rootSchema) as JSONSchema }
  })
  if (resolved.some((r) => !isSchemaObject(r.schema))) return null

  const discriminator = findDiscriminator(resolved.map((r) => r.schema as JSONSchema))
  if (discriminator === null) return null

  const cases: { value: unknown; parser: string }[] = []
  for (const r of resolved) {
    const value = getDiscriminatorValue(r.schema as JSONSchema, discriminator)
    if (value === null) return null
    cases.push({ value, parser: r.parser })
  }

  // Read the discriminant safely: `null`/`undefined` is guarded (a property read
  // would throw), and a non-object primitive yields `undefined` (no branch matches).
  const access = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(discriminator)
    ? `.${discriminator}`
    : `[${JSON.stringify(discriminator)}]`
  const discExpr = `input == null ? undefined : (input as Record<string, unknown>)${access}`

  // Fold branches into a nested ternary in declaration order:
  // `_disc === "lit" ? parseLit(input) : _disc === "binop" ? parseBinop(input) : <fallback>`.
  // Unmatched: strict throws (not a member of the union); non-strict coerces via the
  // first branch's parser, preserving the coercing parser's lenient contract while
  // still running real validation/coercion instead of a blind cast.
  const fallback = strict
    ? `(() => { throw new Error(${quoteJsString(`[${typeName}] value does not match any union branch`)}); })()`
    : `${cases[0]?.parser}(input)`
  let expr = fallback
  for (let i = cases.length - 1; i >= 0; i--) {
    const c = cases[i]
    if (c) expr = `_disc === ${JSON.stringify(c.value)} ? ${c.parser}(input) : ${expr}`
  }
  return `export const ${functionName} = (input: unknown): ${typeName} => {\n  const _disc = ${discExpr};\n  return ${expr};\n};`
}

const generateNonObjectParser = (
  typeName: string,
  schema: JSONSchema,
  strict?: boolean,
  unionCtx?: UnionParserContext,
): string => {
  const functionName = generateParserName(typeName)

  // A ref-branch discriminated union dispatches to its branch parsers in *both*
  // modes (strict throws on an unmatched discriminant; non-strict coerces via the
  // first branch). This runs before the `!strict` coercion block below so a strict
  // recursive union is validated instead of blindly cast.
  if (unionCtx && isSchemaObject(schema) && (hasOneOf(schema) || hasAnyOf(schema))) {
    const branches = hasOneOf(schema) ? schema.oneOf : hasAnyOf(schema) ? schema.anyOf : []
    if (branches.length > 0 && branches.every((b) => isSchemaObject(b) && hasRef(b))) {
      const dispatch = generateRefUnionDispatch(functionName, typeName, branches as JSONSchema[], strict, unionCtx)
      if (dispatch !== null) return dispatch
    }
  }

  // An alias definition (a bare `$ref` with no shape of its own, e.g. a root
  // schema that is just `$ref: '#/$defs/expr'`) delegates to the referenced
  // parser instead of blindly casting, in both modes. Guarded against
  // self-reference: delegating to ourselves would recurse forever.
  if (unionCtx?.useRefImports && isSchemaObject(schema) && hasRef(schema) && !hasProperties(schema)) {
    const refName = refToName((schema as { $ref: string }).$ref, unionCtx.suffix)
    if (refName !== typeName) {
      return `export const ${functionName} = (input: unknown): ${typeName} => ${generateParserName(refName)}(input) as ${typeName};`
    }
  }

  // Strict union enforcement for inline (or mixed) branches: membership is the
  // disjunction of per-branch checks, and a non-member throws. Only emitted
  // when every branch check is false-sound (see canEnforceUnion) — otherwise a
  // conservative stub validator somewhere in the graph could reject valid
  // input — and never when stripping unknown keys (see UnionParserContext).
  if (strict && unionCtx && isSchemaObject(schema)) {
    const branches = getUnionBranches(schema)
    if (branches && !unionCtx.stripUnknown && canEnforceUnion(branches, unionCtx.rootSchema)) {
      const check = generateUnionCheck('input', branches, unionCtx.useRefImports, unionCtx.suffix)
      if (check !== null) {
        return `export const ${functionName} = (input: unknown): ${typeName} => {\n  if (!(${check})) throw new Error(${quoteJsString(`[${typeName}] value does not match any union branch`)});\n  return input as ${typeName};\n};`
      }
    }
  }

  // `const`/`enum` define the value space directly (the generated type is a
  // literal / literal-union), so a non-member must coerce to a valid member —
  // otherwise the returned value would not be of the declared type. This runs
  // before the `type` switch so e.g. `{ type: 'string', enum: [...] }` is covered,
  // and before the no-`type` bail so a bare `const`/`enum` schema is covered too.
  if (!strict && isSchemaObject(schema)) {
    if (hasConst(schema)) {
      const literal = JSON.stringify(schema.const)
      // The const is the only valid value, so the parser always yields it. For a
      // primitive we can keep the caller's value when it already equals the const
      // (`===` is a correct comparison); for an object/array, `===` would be a
      // (always-false) reference comparison, so just return the const literal.
      const isPrimitive = schema.const === null || typeof schema.const !== 'object'
      return isPrimitive
        ? `export const ${functionName} = (input: unknown): ${typeName} => input === ${literal} ? input as ${typeName} : ${literal} as ${typeName};`
        : `export const ${functionName} = (input: unknown): ${typeName} => ${literal} as ${typeName};`
    }
    if (hasEnum(schema) && schema.enum.length > 0) {
      const values = JSON.stringify(schema.enum)
      const fallback = JSON.stringify(schema.enum[0])
      // Case-insensitive normalization sits on the non-member branch only, so an
      // exact member still returns via the `includes` fast path untouched.
      const ci = unionCtx?.caseInsensitive ? generateEnumCaseInsensitiveCoercion('input', schema.enum, fallback) : null
      const coerced = ci ? `(${ci})` : fallback
      return `export const ${functionName} = (input: unknown): ${typeName} => ${values}.includes(input as never) ? input as ${typeName} : ${coerced} as ${typeName};`
    }
    // A top-level union must validate membership: an unmatched value is not of
    // the declared union type, so coerce it to a member-shaped default. Reuse the
    // same union validation the property path uses.
    if (hasOneOf(schema) || hasAnyOf(schema)) {
      const branches = hasOneOf(schema) ? schema.oneOf : hasAnyOf(schema) ? schema.anyOf : []
      const hasRefBranch = branches.some((b) => isSchemaObject(b) && hasRef(b))
      if (branches.length > 0 && !hasRefBranch) {
        const fallback = scalarDefaultLiteral(branches[0] as JSONSchema)
        const expr = generateValidationExpression('', schema, fallback, true, undefined, undefined, 'input', true)
        return `export const ${functionName} = (input: unknown): ${typeName} => (${expr}) as ${typeName};`
      }
      // Ref-branch union: a *discriminated* one was already dispatched above (both
      // modes). Anything reaching here is non-discriminated, which can't be validated
      // inline without risking dropping valid input — fall back to a passthrough cast.
      return `export const ${functionName} = (input: unknown): ${typeName} => input as ${typeName};`
    }
  }

  // Root-level arrays with rich item schemas delegate every element to a real
  // parser, so nested enums and $refs inside array items are validated instead
  // of spread through unchecked. $ref items call the imported parser; inline
  // object items get a private item sub-parser in the same file. (Scalar and
  // enum items are covered below: the lax switch coerces them element-wise and
  // generateScalarStrictAssertion enforces them in strict mode.)
  if (
    isSchemaObject(schema) &&
    hasType(schema) &&
    schema.type === 'array' &&
    hasItems(schema) &&
    !Array.isArray(schema.items)
  ) {
    const items = schema.items
    const notArrayThrow = `if (!Array.isArray(input)) throw new Error(\`[${typeName}] expected array, got \${input === null ? "null" : typeof input}\`);`
    // validateArray identity-returns the input array when every element parses
    // to itself; this parser is EXPORTED, and exported parsers never alias the
    // value the caller passed in (matching the scalar root-array path's
    // `[...input]` copy), so materialize a copy exactly when that happens —
    // element references are still shared, like every other fast path.
    const delegatedBody = (itemParserName: string): string =>
      `  const _parsed = validateArray(input, ${itemParserName});\n  return (_parsed === input ? [..._parsed] : _parsed) as ${typeName};`
    const delegated = (itemParserName: string): string =>
      strict
        ? `export const ${functionName} = (input: unknown): ${typeName} => {\n  ${notArrayThrow}\n${delegatedBody(itemParserName)}\n};`
        : `export const ${functionName} = (input: unknown): ${typeName} => {\n${delegatedBody(itemParserName)}\n};`

    if (unionCtx?.useRefImports && isSchemaObject(items) && hasRef(items)) {
      return delegated(generateParserName(refToName((items as { $ref: string }).$ref, unionCtx.suffix)))
    }

    if (isInlineObjectProperty(items)) {
      const reserved = unionCtx?.reservedNames ?? NO_RESERVED_NAMES
      // Dedup against imported identifiers: a root `List` whose items carry a
      // $ref to `#/$defs/listItem` imports parseListItem — a bare `ListItem`
      // here would shadow it (TS2440) and self-recurse instead of delegating.
      let itemName = `${typeName}_Item`
      while (reserved.has(itemName)) itemName = `${itemName}_`
      const useRefImports = unionCtx?.useRefImports ?? false
      const suffix = unionCtx?.suffix ?? ''
      const stripUnknown = unionCtx?.stripUnknown ?? false
      const preamble = [
        `type ${itemName} = ${typeName}[number];`,
        generateShapeValidator(items, itemName, useRefImports, suffix, false, stripUnknown, reserved),
        generateObjectParser(
          items,
          itemName,
          useRefImports,
          suffix,
          unionCtx?.logWarnings ?? false,
          strict,
          false,
          stripUnknown,
          unionCtx?.rootSchema,
          reserved,
          unionCtx?.caseInsensitive ?? false,
        ),
      ].join('\n\n')
      return `${preamble}\n\n${delegated(generateParserName(itemName))}`
    }
  }

  if (!isSchemaObject(schema) || !hasType(schema)) {
    // Schema without type information cannot be validated beyond a cast
    return `export const ${functionName} = (input: unknown): ${typeName} => input as ${typeName};`
  }

  if (!strict && schema.type === 'null') {
    return `export const ${functionName} = (input: unknown): ${typeName} => null as ${typeName};`
  }

  if (strict) {
    const assertion = generateScalarStrictAssertion(schema, typeName)
    if (assertion === null) {
      return `export const ${functionName} = (input: unknown): ${typeName} => input as ${typeName};`
    }
    const returnExpr =
      schema.type === 'array' ? `[...(input as readonly unknown[])] as ${typeName}` : `input as ${typeName}`
    return `export const ${functionName} = (input: unknown): ${typeName} => {\n${assertion}\n  return ${returnExpr};\n};`
  }

  switch (schema.type) {
    case 'string':
      return `export const ${functionName} = (input: unknown): ${typeName} => typeof input === "string" ? input as ${typeName} : "" as ${typeName};`
    case 'number':
      return `export const ${functionName} = (input: unknown): ${typeName} => typeof input === "number" ? input as ${typeName} : 0 as ${typeName};`
    case 'integer':
      // `integer` rejects non-integral numbers; a bare typeof would accept `1.5`.
      return `export const ${functionName} = (input: unknown): ${typeName} => typeof input === "number" && Number.isInteger(input) ? input as ${typeName} : 0 as ${typeName};`
    case 'boolean':
      return `export const ${functionName} = (input: unknown): ${typeName} => typeof input === "boolean" ? input as ${typeName} : false as ${typeName};`
    case 'array': {
      // Coerce each element when the item schema is a single scalar type or an enum.
      if (hasItems(schema) && !Array.isArray(schema.items) && isCoercibleItemSchema(schema.items)) {
        const item = schema.items
        const itemExpr = generateValidationExpression(
          '',
          item,
          getDefaultValue(item),
          true,
          undefined,
          undefined,
          '_it',
          true,
          unionCtx?.caseInsensitive,
        )
        return `export const ${functionName} = (input: unknown): ${typeName} => Array.isArray(input) ? (input as unknown[]).map((_it) => ${itemExpr}) as ${typeName} : [] as ${typeName};`
      }
      return `export const ${functionName} = (input: unknown): ${typeName} => Array.isArray(input) ? [...input] as ${typeName} : [] as ${typeName};`
    }
    default:
      return `export const ${functionName} = (input: unknown): ${typeName} => input as ${typeName};`
  }
}

/**
 * Generates a parser for empty object schemas or schemas with only additionalProperties.
 * Validates the input is an object before casting, falling back to an empty object.
 * Returns a shallow copy to avoid mutating the original input.
 */
const generateEmptyObjectParser = (typeName: string, strict?: boolean): string => {
  const functionName = generateParserName(typeName)
  if (strict) {
    return `export const ${functionName} = (input: unknown): ${typeName} => {\n  if (!isObject(input)) throw new Error(\`[${typeName}] expected object, got \${input === null ? "null" : typeof input}\`);\n  return { ...input } as ${typeName};\n};`
  }
  return `export const ${functionName} = (input: unknown): ${typeName} => isObject(input) ? { ...input } as ${typeName} : {} as ${typeName};`
}

/**
 * Converts a property key to a safe local variable name for caching.
 * Replaces non-identifier characters with underscores.
 */
const toVarName = (key: string): string => {
  const safe = key.replace(/[^a-zA-Z0-9_$]/g, '_')
  return `_${safe}`
}

/** PascalCases a property key for use in a synthesized sub-type name. */
const pascalCaseKey = (key: string): string =>
  key
    .replace(/[^a-zA-Z0-9_$]/g, '_')
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

/**
 * Property-key → synthesized-type-name maps for the private sub-parsers of a
 * schema: inline nested object properties (parent `Order` + key `shipTo` →
 * `Order_ShipTo`) and array properties with inline object items (key `lines`
 * → `Order_LinesItem`). Both the parser and the shape validator derive the
 * maps independently, so the naming (including collision suffixes) is a pure
 * function of the schema, the parent type name, and the file's reserved
 * names. The `_` level separator is load-bearing: PascalCased key fragments
 * never contain one, so names synthesized in *different* subtrees can never
 * collide (`Order_A_BItem` vs `Order_AB_Item`) — without it, sibling subtrees
 * could both derive `OrderABItem` and emit duplicate declarations that fail
 * to compile.
 */
type InlineSubTypeNames = {
  readonly objects: Map<string, string>
  readonly arrayItems: Map<string, string>
}

/** Shared empty reserved-name set for callers with no import context. */
const NO_RESERVED_NAMES: ReadonlySet<string> = new Set()

/**
 * Shared empty result for the common no-inline-sub-types case, so the per-node
 * calls (parser and validator, for every object node, on every generation)
 * allocate nothing. Callers only read from the maps.
 */
const EMPTY_SUB_TYPES: InlineSubTypeNames = { objects: new Map(), arrayItems: new Map() }

const collectInlineSubTypes = (
  schema: JSONSchema,
  typeName: string,
  reservedNames: ReadonlySet<string> = NO_RESERVED_NAMES,
): InlineSubTypeNames => {
  if (!hasProperties(schema)) return EMPTY_SUB_TYPES
  const props = schema.properties as Record<string, JSONSchema>

  // Single pass with lazy allocation: most object nodes have neither inline
  // object properties nor inline-object array items, and this runs for every
  // node in both the parser and the validator — so nothing is allocated until
  // the first match, and the classification predicates run exactly once per
  // property (an eager pre-scan would re-evaluate them for matching schemas).
  let objects: Map<string, string> | null = null
  let arrayItems: Map<string, string> | null = null
  let used: Set<string> | null = null
  const claim = (base: string): string => {
    used ??= new Set()
    let subName = base
    while (used.has(subName) || reservedNames.has(subName)) subName = `${subName}_`
    used.add(subName)
    return subName
  }

  for (const key in props) {
    const propSchema = props[key] as JSONSchema
    if (isInlineObjectProperty(propSchema)) {
      objects ??= new Map()
      objects.set(key, claim(`${typeName}_${pascalCaseKey(key) || 'Value'}`))
    } else if (isInlineObjectArrayProperty(propSchema)) {
      arrayItems ??= new Map()
      arrayItems.set(key, claim(`${typeName}_${pascalCaseKey(key) || 'Value'}Item`))
    }
  }
  if (objects === null && arrayItems === null) return EMPTY_SUB_TYPES
  return { objects: objects ?? EMPTY_SUB_TYPES.objects, arrayItems: arrayItems ?? EMPTY_SUB_TYPES.arrayItems }
}

/**
 * True when the parser must reject (strict mode) or strip (coerce mode) every
 * undeclared key: the schema sets `additionalProperties: false` and nothing
 * else (key patterns, composition) can legitimately introduce extra keys.
 */
const hasStrictKeys = (schema: JSONSchema): boolean => {
  if (!isSchemaObject(schema) || !hasProperties(schema)) return false
  if (!hasAdditionalProperties(schema) || schema.additionalProperties !== false) return false
  if ('patternProperties' in schema) return false
  if (hasAllOf(schema) || hasOneOf(schema) || hasAnyOf(schema)) return false
  return true
}

/**
 * When every declared property is required (and every required key is
 * declared, with a real schema), the fast-path known-keys test can be an
 * own-key *count* comparison instead of a per-key `for..in` walk: the typed
 * property checks already prove all N declared keys are present, so
 * `Object.keys(input).length === N` proves there are no undeclared extras —
 * measurably cheaper on the hot path. Returns the declared-key count, or null
 * when the cheaper form would be unsound (an optional or non-schema property
 * breaks the presence proof).
 */
const exactKeyCountOf = (schema: JSONSchema): number | null => {
  if (!isSchemaObject(schema) || !hasProperties(schema) || !hasRequired(schema)) return null
  const props = schema.properties as Record<string, JSONSchema>
  const required = schema.required as readonly string[]
  // Allocation-free for the common small object: this runs for every object
  // node, in both the parser and the validator, on every generation, and the
  // O(n²) `includes` beats building a Set for a handful of keys. Wide schemas
  // (generated API models) flip to a one-time Set so a 200-property object
  // doesn't pay ~20k string comparisons per node.
  const requiredLookup = required.length > 16 ? new Set(required) : null
  let declaredCount = 0
  for (const key in props) {
    declaredCount++
    // Every declared key must be required, and its check must prove presence —
    // all schema-object checks fail on undefined, but a true/false schema
    // literal emits no check at all.
    const isRequired = requiredLookup !== null ? requiredLookup.has(key) : required.includes(key)
    if (!isRequired || !isSchemaObject(props[key] as JSONSchema)) return null
  }
  // Every declared key is required (above) and the counts match, so the
  // required list is exactly the declared keys (a duplicated required entry
  // would leave some declared key uncovered and fail the loop).
  if (declaredCount === 0 || required.length !== declaredCount) return null
  return declaredCount
}

/**
 * Determines if a property needs a local variable or can be inlined.
 * Schema-object properties are always cached: the slow-path ternary chain
 * reads each value 3-4x (typeof check, valid branch, undefined check, coerce),
 * so a single hoisted load is strictly cheaper than the inlined optional chain.
 */
const shouldCacheVariable = (propSchema: JSONSchema, _canFastPath: boolean, _useRefImports: boolean): boolean => {
  // Non-schema-object properties (true/false JSON Schema literals) generate
  // `undefined` with no value access, so caching would be wasted.
  return isSchemaObject(propSchema)
}

/**
 * Generates a parser for object schemas with properties.
 *
 * Uses an optimized function body with:
 * - Early return for non-object input
 * - Selective variable caching (only when needed)
 * - Fast path that returns input directly when all properties are already valid
 * - Slow path with optimized expressions
 */
const generateObjectParser = (
  schema: JSONSchema,
  typeName: string,
  useRefImports: boolean,
  suffix: string,
  logWarnings?: boolean,
  strict?: boolean,
  exported = true,
  stripUnknown = false,
  rootSchema?: Record<string, unknown>,
  reservedNames: ReadonlySet<string> = NO_RESERVED_NAMES,
  caseInsensitive = false,
): string => {
  const functionName = generateParserName(typeName)
  const exportPrefix = exported ? 'export ' : ''

  if (!hasProperties(schema)) {
    if (strict) {
      return `${exportPrefix}const ${functionName} = (input: unknown): ${typeName} => {\n  if (!isObject(input)) throw new Error(\`[${typeName}] expected object, got \${input === null ? "null" : typeof input}\`);\n  return input as ${typeName};\n};`
    }
    return `${exportPrefix}const ${functionName} = (input: unknown): ${typeName} => isObject(input) ? input as ${typeName} : {} as ${typeName};`
  }

  const schemaProps = (schema as { properties: Record<string, JSONSchema> }).properties
  // Keys once, values via lookup — Object.entries allocates a tuple per
  // property and this runs for every object node on every generation.
  const propertyKeys = Object.keys(schemaProps)

  // Inline nested object properties get a private sub-parser (plus shape
  // predicate and type alias) in the same file, so their fields are parsed for
  // real instead of only passing an isObject check. The sub-parser recurses
  // through this same generator, so nesting works to any depth. Array
  // properties with inline object items get the same treatment for their
  // element type, so nested enums and $refs *inside array items* are validated
  // too (each element runs through the item sub-parser via validateArray).
  const { objects: subTypeNames, arrayItems: subItemNames } = collectInlineSubTypes(schema, typeName, reservedNames)
  const preamble: string[] = []

  for (const [key, subName] of subTypeNames) {
    const propSchema = schemaProps[key] as JSONSchema
    preamble.push(`type ${subName} = ${typeName}[${JSON.stringify(key)}];`)
    preamble.push(
      generateShapeValidator(propSchema, subName, useRefImports, suffix, false, stripUnknown, reservedNames),
    )
    preamble.push(
      generateObjectParser(
        propSchema,
        subName,
        useRefImports,
        suffix,
        logWarnings,
        strict,
        false,
        stripUnknown,
        rootSchema,
        reservedNames,
        caseInsensitive,
      ),
    )
  }

  for (const [key, subName] of subItemNames) {
    const propSchema = schemaProps[key] as JSONSchema
    const itemSchema = (propSchema as { items: JSONSchema }).items
    // NonNullable strips the `| undefined` an optional array property carries.
    preamble.push(`type ${subName} = NonNullable<${typeName}[${JSON.stringify(key)}]>[number];`)
    preamble.push(
      generateShapeValidator(itemSchema, subName, useRefImports, suffix, false, stripUnknown, reservedNames),
    )
    // Hand-rolled loop instead of Array.prototype.every on the guard path — the
    // callback protocol costs a few percent on element-heavy hot paths.
    preamble.push(
      `const _every${subName} = (arr: readonly unknown[]): boolean => {\n  for (let i = 0; i < arr.length; i++) if (!${shapeValidatorName(subName)}(arr[i])) return false;\n  return true;\n};`,
    )
    preamble.push(
      generateObjectParser(
        itemSchema,
        subName,
        useRefImports,
        suffix,
        logWarnings,
        strict,
        false,
        stripUnknown,
        rootSchema,
        reservedNames,
        caseInsensitive,
      ),
    )
  }

  // additionalProperties: false — the per-key "is this undeclared" test inlines
  // `!==` comparisons for a short key list and hoists a Set only for a long one
  // (see unknownKeyCheck). The predicate form is shared by the fast path and the
  // shape validator; strict mode throws with the offending key.
  // `additionalProperties: false` strips *and rejects* extras; `stripUnknown`
  // only strips them. Both build the result from declared properties alone, so
  // they share the same machinery (`stripKeys`): drop the `...input` spread and
  // gate the `{ ...input }` fast path on the known-keys predicate. Only the real
  // `strictKeys` makes an extra a hard error (the throw block further down).
  const strictKeys = hasStrictKeys(schema)
  const stripKeys = strictKeys || stripUnknown
  // When every declared property is required, the fast-path no-extras test is
  // the cheaper own-key count (see exactKeyCountOf) and the `_hasOnlyKnownKeys`
  // predicate is not emitted at all — the shape validator derives the same
  // decision from the schema, so the cross-function contract stays in sync.
  const exactKeyCount = stripKeys ? exactKeyCountOf(schema) : null
  const strictKeyCheck = unknownKeyCheck(propertyKeys, `_knownKeys${typeName}`)
  if (stripKeys && exactKeyCount === null) {
    for (const declaration of strictKeyCheck.declarations) {
      preamble.push(`${declaration};`)
    }
    preamble.push(
      `const _hasOnlyKnownKeys${typeName} = (input: Record<string, unknown>): boolean => {\n  for (const _k in input) if (${strictKeyCheck.isUnknown('_k')}) return false;\n  return true;\n};`,
    )
  } else if (strict && strictKeys) {
    // The unknown-key throw loop below still needs the hoisted Set (when the
    // key list is long enough to use one).
    for (const declaration of strictKeyCheck.declarations) {
      preamble.push(`${declaration};`)
    }
  }

  const fallbackObject = generateFallbackObject(schema, useRefImports, typeName, suffix, subTypeNames)

  // First pass: gather per-property info and decide whether a fast path is
  // possible. A fast path returns the input (or a direct strip-build) for
  // already-valid input without re-running per-property validation, so it may
  // only fire when every property can be cheaply proven in-shape.
  const propInfo: {
    readonly key: string
    readonly varName: string
    readonly isRequired: boolean
    readonly propSchema: JSONSchema
  }[] = []

  // Disable fast path when allOf $ref parsers need to be spread — the fast path
  // returns input as-is and would skip those coercions.
  const hasAllOfRefParsers =
    useRefImports &&
    isSchemaObject(schema) &&
    hasAllOf(schema) &&
    schema.allOf.some((entry) => isSchemaObject(entry) && hasRef(entry))

  let canFastPath = !hasAllOfRefParsers
  const fastPathChecks: string[] = []

  // `toVarName` collapses distinct keys that differ only in non-identifier chars
  // (e.g. `a-b` and `a.b` both → `_a_b`), which would emit two `const _a_b`
  // declarations (TS2451). Dedupe by suffixing `_` until unique — the same
  // approach `collectInlineObjectProperties` uses — so each key gets its own var.
  const usedVarNames = new Set<string>()
  for (const key of propertyKeys) {
    const propSchema = schemaProps[key] as JSONSchema
    const isRequired = isPropertyRequired(key, schema)
    let varName = toVarName(key)
    while (usedVarNames.has(varName)) varName = `${varName}_`
    usedVarNames.add(varName)
    propInfo.push({ key, varName, isRequired, propSchema })

    if (!canFastPath) continue

    // Records of refs require iterating every value to check shape — too
    // expensive to inline into the parser's fast path. Disable.
    if (shouldUseRecordRefImport(propSchema, useRefImports)) {
      canFastPath = false
      continue
    }

    const subName = subTypeNames.get(key)
    // Inline nested objects fast-path through their private shape predicate, the
    // same way $ref properties use the imported one. Arrays of inline objects
    // additionally prove every element via the private item predicate.
    let check = subName
      ? `${shapeValidatorName(subName)}(${varName})`
      : generatePropertyTypeCheck(varName, propSchema, useRefImports, suffix)
    const itemSubName = subItemNames.get(key)
    if (check !== null && itemSubName) {
      check = `${check} && _every${itemSubName}(${varName})`
    }
    if (check === null) {
      canFastPath = false
    } else if (isRequired) {
      fastPathChecks.push(check)
    } else {
      fastPathChecks.push(`(${varName} === undefined || ${check})`)
    }
  }

  // The `{ ...input }` fast path preserves extras, so when stripping it may only
  // fire on inputs that carry no undeclared key. For strict + additionalProperties:
  // false the cold path rejects extras instead; folding the known-keys term into
  // the guard lets the guard run *before* that rejection, so a valid clean input
  // never pays for the per-property assertions. With every declared property
  // required, the own-key count is equivalent and cheaper than the per-key walk —
  // but only for plain objects: a crafted prototype could satisfy the typed
  // checks through inherited properties while the own-key count still matches,
  // so non-plain inputs route to the slow path, where the for..in walk keeps
  // the historical inherited-key rejection.
  if (stripKeys) {
    fastPathChecks.push(
      exactKeyCount !== null
        ? `Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === ${exactKeyCount}`
        : `_hasOnlyKnownKeys${typeName}(input)`,
    )
  }

  // The deep guard proves the whole shape (so `{ ...input }` can be returned),
  // using the nested shape predicates and the known-keys term above.
  const deepGuard = canFastPath && fastPathChecks.length > 0 ? fastPathChecks.join(' && ') : null

  // The shallow guard powers the strict strip-build fast path (stripUnknown
  // without additionalProperties: false): it proves every scalar is well-typed
  // and every nested object is an object, but neither walks nested shapes deeply
  // nor requires the absence of extras. That lets it fire on the common
  // stripUnknown input — which carries extras the build removes, and nested
  // extras each sub-parser removes — while the cold path's per-property
  // assertions still produce the precise error on a genuine mismatch.
  let canShallowGuard = strict && stripUnknown && !strictKeys
  const shallowChecks: string[] = []
  if (canShallowGuard) {
    for (const { key, varName, isRequired, propSchema } of propInfo) {
      const subName = subTypeNames.get(key)
      let check: string | null
      if (subName) {
        // Nested inline object: a shallow `isObject` is enough — the sub-parser
        // validates and strips it.
        check = `isObject(${varName})`
      } else if (
        isSchemaObject(propSchema) &&
        !hasEnum(propSchema) &&
        !hasRef(propSchema) &&
        !hasOneOf(propSchema) &&
        !hasAnyOf(propSchema) &&
        !hasAllOf(propSchema) &&
        !('not' in propSchema) &&
        !shouldUseRefImport(propSchema, useRefImports) &&
        !shouldUseArrayRefImport(propSchema, useRefImports) &&
        !shouldUseRecordRefImport(propSchema, useRefImports)
      ) {
        // Plain scalar / array / object: its own type check is already shallow
        // (arrays are not walked, objects only `isObject`-checked).
        check = generatePropertyTypeCheck(varName, propSchema, useRefImports, suffix)
      } else {
        check = null
      }
      if (check === null) {
        canShallowGuard = false
        break
      }
      shallowChecks.push(isRequired ? check : `(${varName} === undefined || ${check})`)
    }
  }
  const shallowGuard = canShallowGuard && shallowChecks.length > 0 ? shallowChecks.join(' && ') : null

  // Variable declarations for properties that need them (the build and guards
  // read each cached value once instead of re-accessing `input`).
  const varDeclLines: string[] = []
  for (const { key, varName, propSchema } of propInfo) {
    if (shouldCacheVariable(propSchema, canFastPath, useRefImports)) {
      varDeclLines.push(`  const ${varName} = ${safeAccessor('input', key)};`)
    }
  }

  // Emit a warning for any input key not declared in the schema's properties.
  const warnLines: string[] = []
  if (logWarnings && propInfo.length > 0) {
    const warnKeyCheck = unknownKeyCheck(
      propInfo.map(({ key }) => key),
      '_knownKeys',
    )
    for (const declaration of warnKeyCheck.declarations) {
      warnLines.push(`  ${declaration};`)
    }
    warnLines.push(`  for (const _k in input) {`)
    warnLines.push(`    if (${warnKeyCheck.isUnknown('_k')}) {`)
    warnLines.push(`      console.warn(\`[${typeName}] Unknown property "\${_k}"\`);`)
    warnLines.push(`    }`)
    warnLines.push(`  }`)
  }

  // Builds the result object literal. `directAssign` (strict mode) assigns each
  // field straight from its cached read — the guard or the per-property
  // assertions have already proven the type, so no coercion ternary is needed.
  // Coerce mode keeps the type-checking-and-coercing expression. Refs, arrays of
  // refs, records of refs and inline nested objects always delegate to their
  // parser in both modes; the input spread is dropped whenever stripping.
  const buildObjectLines = (directAssign: boolean): string[] => {
    const objectLines: string[] = []
    if (!stripKeys) {
      objectLines.push('    ...input,')
    }

    // Spread allOf $ref parsers so their field coercions are applied before
    // the explicit property validations below.
    if (useRefImports && isSchemaObject(schema) && hasAllOf(schema)) {
      for (const entry of schema.allOf) {
        if (isSchemaObject(entry) && hasRef(entry)) {
          const parserName = generateParserName(refToName(entry.$ref, suffix))
          objectLines.push(`    ...(${parserName}(input) as Record<string, unknown>),`)
        }
      }
    }

    for (const { key, varName, isRequired, propSchema } of propInfo) {
      const shouldCache = shouldCacheVariable(propSchema, canFastPath, useRefImports)
      const accessor = shouldCache ? varName : safeAccessor('input', key)

      // Handle inline nested objects via their private sub-parser, mirroring
      // how $ref properties delegate to the imported parser.
      const subName = subTypeNames.get(key)
      if (subName) {
        const subParserName = generateParserName(subName)
        if (isRequired) {
          objectLines.push(`    ${safeKey(key)}: ${subParserName}(${accessor}),`)
        } else {
          objectLines.push(`    ...(${accessor} !== undefined && { ${safeKey(key)}: ${subParserName}(${accessor}) }),`)
        }
        continue
      }

      // Arrays of inline objects run every element through the private item
      // sub-parser, the same way arrays of $refs delegate via validateArray.
      // In strict mode the item parser throws on a bad element; in coerce mode
      // it repairs the element to a valid instance.
      const itemSubName = subItemNames.get(key)
      if (itemSubName) {
        const itemParserName = generateParserName(itemSubName)
        if (isRequired) {
          objectLines.push(`    ${safeKey(key)}: validateArray(${accessor}, ${itemParserName}),`)
        } else {
          objectLines.push(
            `    ...(${accessor} !== undefined && { ${safeKey(key)}: validateArray(${accessor}, ${itemParserName}) }),`,
          )
        }
        continue
      }

      // Handle direct $ref properties via imported parsers
      if (shouldUseRefImport(propSchema, useRefImports)) {
        const ref = (propSchema as { $ref: string }).$ref
        const parserName = generateParserName(refToName(ref, suffix))
        if (isRequired) {
          objectLines.push(`    ${safeKey(key)}: ${parserName}(${accessor}),`)
        } else {
          objectLines.push(`    ...(${accessor} !== undefined && { ${safeKey(key)}: ${parserName}(${accessor}) }),`)
        }
        continue
      }

      // Handle array properties with $ref items
      if (shouldUseArrayRefImport(propSchema, useRefImports)) {
        const items = (propSchema as { items: { $ref: string } }).items
        const ref = items.$ref
        const parserName = generateParserName(refToName(ref, suffix))
        if (isRequired) {
          objectLines.push(`    ${safeKey(key)}: validateArray(${accessor}, ${parserName}),`)
        } else {
          objectLines.push(
            `    ...(${accessor} !== undefined && { ${safeKey(key)}: validateArray(${accessor}, ${parserName}) }),`,
          )
        }
        continue
      }

      // Handle object properties with additionalProperties $ref
      if (shouldUseRecordRefImport(propSchema, useRefImports)) {
        const additionalProps = (propSchema as { additionalProperties: { $ref: string } }).additionalProperties
        const ref = additionalProps.$ref
        const parserName = generateParserName(refToName(ref, suffix))
        if (isRequired) {
          objectLines.push(`    ${safeKey(key)}: validateRecord(${accessor}, ${parserName}),`)
        } else {
          objectLines.push(
            `    ...(${accessor} !== undefined && { ${safeKey(key)}: validateRecord(${accessor}, ${parserName}) }),`,
          )
        }
        continue
      }

      // Handle non-schema-object properties
      if (!isSchemaObject(propSchema)) {
        if (isRequired) {
          objectLines.push(`    ${safeKey(key)}: undefined,`)
        }
        continue
      }

      // Strict mode has already proven the value's type (by guard or assertion),
      // so the field is assigned straight from the cached read with no coercion.
      let valueExpr: string
      if (directAssign) {
        valueExpr = accessor
      } else {
        const defaultValue = getDefaultValue(propSchema)
        // For optional properties we know the value is not undefined because
        // we're inside the `...(accessor !== undefined && { ... })` check.
        const knownNotUndefined = !isRequired
        valueExpr = generateValidationExpression(
          key,
          propSchema,
          defaultValue,
          true,
          undefined,
          undefined,
          shouldCache ? varName : undefined,
          knownNotUndefined,
          caseInsensitive,
        )
      }

      if (isRequired) {
        objectLines.push(`    ${safeKey(key)}: ${valueExpr},`)
      } else {
        objectLines.push(`    ...(${accessor} !== undefined && { ${safeKey(key)}: ${valueExpr} }),`)
      }
    }

    return objectLines
  }

  const emitReturn = (lines: string[], objectLines: string[]): void => {
    lines.push(`  return {`)
    lines.push(objectLines.join('\n'))
    lines.push(`  } as unknown as ${typeName};`)
  }

  // The deep-guard fast path. `{ ...input }` is the only correct shape when the
  // guard let undeclared keys through (no known-keys term) — they must survive.
  // But when `stripKeys` is set the guard *also* proved `_hasOnlyKnownKeys`, so
  // the input's keys are exactly the declared properties: an explicit literal of
  // those keys is then equivalent to the spread, and faster — a fixed-shape
  // literal beats a generic spread, yields a stable hidden class, and produces
  // the same declared key order as the slow path (the spread used input order).
  // The literal shares each value by reference, exactly like the spread did, so
  // it never re-parses an already-validated nested object. allOf merges in
  // properties this `propInfo` list doesn't carry, so it keeps the spread.
  const emitDeepGuardReturn = (lines: string[]): void => {
    const canLiteral = stripKeys && !(isSchemaObject(schema) && hasAllOf(schema))
    if (!canLiteral) {
      lines.push(`  if (${deepGuard}) return { ...input } as ${typeName};`)
      return
    }
    // A *private* (nested-object / array-item) parser whose deep guard proved
    // the input is exactly the declared shape — typed checks plus the
    // no-undeclared-keys term, recursively via sub-predicates — can hand the
    // input back by reference instead of allocating a literal. That is the
    // same sharing the parent's own fast-path literal performs (`items:
    // _items`), and it is what keeps clean array elements allocation-free.
    // Exported root parsers keep returning a fresh object so callers never
    // alias the value they passed in.
    if (!exported) {
      lines.push(`  if (${deepGuard}) return input as ${typeName};`)
      return
    }
    const fields: string[] = []
    for (const { key, varName, isRequired, propSchema } of propInfo) {
      if (!isSchemaObject(propSchema)) {
        if (isRequired) fields.push(`    ${safeKey(key)}: undefined,`)
        continue
      }
      const accessor = shouldCacheVariable(propSchema, canFastPath, useRefImports)
        ? varName
        : safeAccessor('input', key)
      fields.push(
        isRequired
          ? `    ${safeKey(key)}: ${accessor},`
          : `    ...(${accessor} !== undefined && { ${safeKey(key)}: ${accessor} }),`,
      )
    }
    lines.push(`  if (${deepGuard}) return {`)
    lines.push(fields.join('\n'))
    lines.push(`  } as ${typeName};`)
  }

  const lines: string[] = []
  lines.push(`${exportPrefix}const ${functionName} = (input: unknown): ${typeName} => {`)

  if (strict) {
    // Guard first: a non-object throws straight away; a clean, well-typed input
    // then short-circuits past the per-property assertions, which only run to
    // pinpoint the failure when the guard rejects the input.
    lines.push(
      `  if (!isObject(input)) throw new Error(\`[${typeName}] expected object, got \${input === null ? "null" : typeof input}\`);`,
    )
    lines.push(...varDeclLines)
    lines.push(...warnLines)

    // The first assertion line is the `isObject` check, already done above.
    const assertionLines = generateObjectStrictAssertion(schema, typeName, {
      useRefImports,
      suffix,
      stripUnknown,
      ...(rootSchema !== undefined ? { rootSchema } : {}),
    }).slice(1)

    if (shallowGuard) {
      // A private sub-parser hands input that is already exactly the declared
      // shape (no extras at any level) back by reference, so a clean array
      // element or nested object costs no allocation. The deep guard is
      // evaluated as the shallow guard plus only its *residual* terms (deeper
      // per-property checks and the no-extras term), so a carries-extras input
      // never runs the same typed checks twice before taking the strip build.
      if (!exported && deepGuard) {
        const residual: string[] = []
        for (let i = 0; i < fastPathChecks.length; i++) {
          const deep = fastPathChecks[i] as string
          const shallow = shallowChecks[i]
          if (deep === shallow) continue
          // When the deep check extends the shallow one by conjunction (e.g.
          // `Array.isArray(_x) && _everyItem(_x)`), the shallow guard already
          // proved the prefix — re-evaluating it per clean parse was pure
          // waste on the hot path, so only the extension joins the residual.
          residual.push(
            shallow !== undefined && deep.startsWith(`${shallow} && `) ? deep.slice(shallow.length + 4) : deep,
          )
        }
        lines.push(`  if (${shallowGuard}) {`)
        lines.push(
          residual.length > 0
            ? `    if (${residual.join(' && ')}) return input as ${typeName};`
            : `    return input as ${typeName};`,
        )
        lines.push(`  } else {`)
        for (const assertionLine of assertionLines) {
          lines.push(`  ${assertionLine}`)
        }
        lines.push(`  }`)
      } else {
        // stripUnknown: a well-typed input skips the assertions and goes
        // straight to the strip build (which removes extras and recurses into
        // sub-parsers).
        lines.push(`  if (!(${shallowGuard})) {`)
        for (const assertionLine of assertionLines) {
          lines.push(`  ${assertionLine}`)
        }
        lines.push(`  }`)
      }
      emitReturn(lines, buildObjectLines(true))
    } else {
      if (deepGuard) {
        emitDeepGuardReturn(lines)
      }
      for (const assertionLine of assertionLines) {
        lines.push(assertionLine)
      }
      if (strictKeys) {
        // for..in (not Object.keys) deliberately: this loop is cold — the fast
        // path already proved the key set — but swapping in the keys-array
        // iterator here once regressed the *hot* path several percent on CI:
        // the extra dead-path bytecode changed the engine's inlining of the
        // whole parser. The fast-path no-extras test uses own-key semantics;
        // an inherited-key mismatch merely lands here and keeps the historical
        // for..in rejection.
        lines.push(`  for (const _k in input) {`)
        lines.push(
          `    if (${strictKeyCheck.isUnknown('_k')}) throw new Error(\`[${typeName}] unknown property "\${_k}"\`);`,
        )
        lines.push(`  }`)
      }
      emitReturn(lines, buildObjectLines(true))
    }
  } else {
    lines.push(`  if (!isObject(input)) return ${fallbackObject};`)
    lines.push(...varDeclLines)
    lines.push(...warnLines)
    if (deepGuard) {
      emitDeepGuardReturn(lines)
    }
    emitReturn(lines, buildObjectLines(false))
  }

  lines.push(`}`)

  const fn = lines.join('\n')
  if (preamble.length === 0) return fn
  return `${preamble.join('\n\n')}\n\n${fn}`
}

/**
 * Combined-parser variant for `properties` + `patternProperties` schemas that
 * set `additionalProperties: false`. Declared properties are coerced as usual,
 * keys matching any pattern are kept (the first `$ref` pattern is coerced via
 * its imported parser when ref imports are on), and every other key is rejected
 * in strict mode or stripped in coerce mode — matching the interpreter.
 */
const generateStrictCombinedParser = (
  schema: JSONSchema,
  typeName: string,
  functionName: string,
  propertyLines: string[],
  patterns: [string, JSONSchema][],
  useRefImports: boolean,
  suffix: string,
  strict?: boolean,
): string => {
  const declaredKeys = hasProperties(schema) ? Object.keys(schema.properties) : []
  // Below the inline threshold a key === "a" || key === "b" chain skips declared
  // keys without the per-call Set allocation; a wider list hoists the Set.
  const knownKeyCheck = unknownKeyCheck(declaredKeys, '_knownKeys')

  // The first $ref pattern (when ref imports are on) coerces its matching values
  // through the imported parser; the remaining patterns keep the raw value.
  const refPattern = useRefImports ? patterns.find(([, ps]) => isSchemaObject(ps) && hasRef(ps)) : undefined
  const loopLines: string[] = [`    if (${knownKeyCheck.isKnown('key')}) continue;`]
  if (refPattern) {
    const parserName = generateParserName(refToName((refPattern[1] as { $ref: string }).$ref, suffix))
    loopLines.push(`    if (/${escapeRegexPattern(refPattern[0])}/.test(key)) {`)
    loopLines.push(`      (result as Record<string, unknown>)[key] = ${parserName}(input[key]);`)
    loopLines.push(`      continue;`)
    loopLines.push(`    }`)
  }

  const keepConditions = patterns
    .filter(([p]) => !(refPattern && p === refPattern[0]))
    .map(([p]) => `/${escapeRegexPattern(p)}/.test(key)`)
  if (keepConditions.length > 0) {
    loopLines.push(`    if (${keepConditions.join(' || ')}) {`)
    loopLines.push(`      (result as Record<string, unknown>)[key] = input[key];`)
    loopLines.push(`      continue;`)
    loopLines.push(`    }`)
  }

  // Unknown key: throw in strict mode, otherwise let it fall through (dropped,
  // since it was never copied into `result`).
  if (strict) loopLines.push(`    throw new Error(\`[${typeName}] unknown property "\${key}"\`);`)

  const notObjectBranch = strict
    ? `    throw new Error(\`[${typeName}] expected object, got \${input === null ? "null" : typeof input}\`);`
    : `    return {} as unknown as ${typeName};`
  const resultBody = propertyLines.length > 0 ? `{\n${propertyLines.join('\n')}\n  }` : '{}'
  // Only the Set form needs a declaration; the inline === chain is stateless.
  const knownKeysDeclaration = knownKeyCheck.declarations.map((decl) => `  ${decl};\n`).join('')

  return `export const ${functionName} = (input: unknown): ${typeName} => {
  if (!isObject(input)) {
${notObjectBranch}
  }
${knownKeysDeclaration}  const result = ${resultBody} as unknown as ${typeName};
  for (const key in input) {
${loopLines.join('\n')}
  }
  return result;
};`
}

/**
 * Generates a parser for schemas that have both properties AND patternProperties.
 * Parses the known properties first, then iterates remaining keys to match patterns.
 */
const generateCombinedObjectParser = (
  schema: JSONSchema,
  typeName: string,
  useRefImports: boolean,
  suffix: string,
  logWarnings?: boolean,
  strict?: boolean,
  stripUnknown = false,
  caseInsensitive = false,
): string => {
  const functionName = generateParserName(typeName)
  const entries = generatePropertyEntries(schema, useRefImports, suffix, caseInsensitive)

  // Build the known property lines for the initial object
  const propertyLines = entries.map((entry) => {
    if (entry.isOptional) {
      return `    ${entry.value},`
    }
    return `    ${safeKey(entry.key)}: ${entry.value},`
  })

  // Find the first pattern with a $ref for parser delegation
  if (!isSchemaObject(schema) || !('patternProperties' in schema)) {
    return generateObjectParser(
      schema,
      typeName,
      useRefImports,
      suffix,
      logWarnings,
      strict,
      true,
      stripUnknown,
      undefined,
      NO_RESERVED_NAMES,
      caseInsensitive,
    )
  }

  const patternProps = schema.patternProperties as Record<string, JSONSchema>
  const patterns = Object.entries(patternProps)
  const refPattern = patterns.find(([, ps]) => isSchemaObject(ps) && hasRef(ps))
  const strictKeys = hasAdditionalProperties(schema) && schema.additionalProperties === false

  // With `additionalProperties: false`, keys matching neither a declared
  // property nor any pattern must be rejected (strict) or stripped (coerce).
  // The blanket `...input` spread used below cannot do that, so build a
  // selective copy that mirrors the interpreter's undeclared-key handling.
  if (strictKeys) {
    return generateStrictCombinedParser(
      schema,
      typeName,
      functionName,
      propertyLines,
      patterns,
      useRefImports,
      suffix,
      strict,
    )
  }

  if (!refPattern || !useRefImports) {
    return generateObjectParser(
      schema,
      typeName,
      useRefImports,
      suffix,
      logWarnings,
      strict,
      true,
      stripUnknown,
      undefined,
      NO_RESERVED_NAMES,
      caseInsensitive,
    )
  }

  const [pattern, patternSchema] = refPattern
  const ref = (patternSchema as { $ref: string }).$ref
  const parserName = generateParserName(refToName(ref, suffix))
  const assignmentCode = `(result as Record<string, unknown>)[key] = ${parserName}(value);`

  const escapedPattern = escapeRegexPattern(pattern)

  const inputSpread = '    ...input,'
  let objectProperties = inputSpread
  if (propertyLines.length > 0) {
    for (const line of propertyLines) {
      objectProperties += '\n' + line
    }
  }

  const notObjectBranch = strict
    ? `    throw new Error(\`[${typeName}] expected object, got \${input === null ? "null" : typeof input}\`);`
    : `    return {} as unknown as ${typeName};`

  return `export const ${functionName} = (input: unknown): ${typeName} => {
  if (!isObject(input)) {
${notObjectBranch}
  }
  const result = {
${objectProperties}
  } as unknown as ${typeName};
  for (const key in input) {
    if (/${escapedPattern}/.test(key)) {
      const value = input[key];
      ${assignmentCode}
    }
  }
  return result;
};`
}

/**
 * Generates a parser for schemas with additionalProperties.
 */
const generateAdditionalPropertiesParser = (
  schema: JSONSchema.Object,
  typeName: string,
  useRefImports: boolean,
  suffix: string,
  strict?: boolean,
): string => {
  const functionName = generateParserName(typeName)
  const additionalProps = schema.additionalProperties

  // Check if additionalProps is defined before using it
  if (!additionalProps) {
    return generateEmptyObjectParser(typeName, strict)
  }

  // If additionalProperties is a $ref and useRefImports is true, generate a loop
  if (useRefImports && isSchemaObject(additionalProps) && hasRef(additionalProps)) {
    const ref = additionalProps.$ref
    const parserName = generateParserName(refToName(ref, suffix))

    if (strict) {
      return `export const ${functionName} = (input: unknown): ${typeName} => {\n  if (!isObject(input)) throw new Error(\`[${typeName}] expected object, got \${input === null ? "null" : typeof input}\`);\n  return validateRecord(input, ${parserName}) as ${typeName};\n};`
    }
    return `export const ${functionName} = (input: unknown): ${typeName} => validateRecord(input, ${parserName}) as ${typeName};`
  }

  // Handle additionalProperties with a known type by generating inline validation
  if (isSchemaObject(additionalProps) && hasType(additionalProps)) {
    const inlineParser = generateInlineValueParser(additionalProps)
    if (inlineParser) {
      if (strict) {
        return `export const ${functionName} = (input: unknown): ${typeName} => {\n  if (!isObject(input)) throw new Error(\`[${typeName}] expected object, got \${input === null ? "null" : typeof input}\`);\n  return validateRecord(input, ${inlineParser}) as ${typeName};\n};`
      }
      return `export const ${functionName} = (input: unknown): ${typeName} => validateRecord(input, ${inlineParser}) as ${typeName};`
    }
  }

  // Otherwise, just validate the input type and shallow copy
  if (strict) {
    return `export const ${functionName} = (input: unknown): ${typeName} => {\n  if (!isObject(input)) throw new Error(\`[${typeName}] expected object, got \${input === null ? "null" : typeof input}\`);\n  return { ...input } as ${typeName};\n};`
  }
  return `export const ${functionName} = (input: unknown): ${typeName} => isObject(input) ? { ...input } as ${typeName} : {};`
}

/**
 * Generates an inline arrow function that validates a single value based on
 * the additionalProperties schema type. Returns null if the type is not supported.
 *
 * Used to generate parsers for Record-like types where values have a known
 * primitive or array type (e.g. Record<string, string> or Record<string, string[]>).
 */
const generateInlineValueParser = (schema: JSONSchema): string | null => {
  if (!isSchemaObject(schema) || !hasType(schema)) {
    return null
  }

  switch (schema.type) {
    case 'string':
      return '(value: unknown) => typeof value === "string" ? value : ""'
    case 'number':
    case 'integer':
      return '(value: unknown) => typeof value === "number" ? value : 0'
    case 'boolean':
      return '(value: unknown) => typeof value === "boolean" ? value : false'
    case 'array':
      return '(value: unknown) => Array.isArray(value) ? value : []'
    default:
      return null
  }
}

/**
 * Generates a parser for schemas with patternProperties.
 * Handles both patternProperties and specification-extensions (x- prefix).
 */
const generatePatternPropertiesParser = (
  schema: JSONSchema.Object,
  typeName: string,
  useRefImports: boolean,
  suffix: string,
  strict?: boolean,
): string => {
  const functionName = generateParserName(typeName)

  if (!('patternProperties' in schema) || typeof schema.patternProperties !== 'object') {
    return generateEmptyObjectParser(typeName, strict)
  }

  const patternProps = schema.patternProperties as Record<string, JSONSchema>

  // Find the first pattern and its schema
  const patterns = Object.entries(patternProps)
  if (patterns.length === 0) {
    return generateEmptyObjectParser(typeName, strict)
  }

  const [pattern, patternSchema] = patterns[0] as [string, JSONSchema]
  let patternAssignment = '(result as Record<string, unknown>)[key] = value;'

  // Use imported parser when pattern schema points to a $ref.
  if (useRefImports && isSchemaObject(patternSchema) && hasRef(patternSchema)) {
    const ref = patternSchema.$ref
    const parserName = generateParserName(refToName(ref, suffix))
    patternAssignment = `(result as Record<string, unknown>)[key] = ${parserName}(value);`
  } else if (patternSchema === false) {
    // `false` means no values are allowed for matching keys.
    patternAssignment = ''
  }

  // Escape the pattern for safe inclusion in generated code
  const escapedPattern = escapeRegexPattern(pattern)

  const notObjectBranch = strict
    ? `    throw new Error(\`[${typeName}] expected object, got \${input === null ? "null" : typeof input}\`);`
    : `    return {} as unknown as ${typeName};`

  // With `additionalProperties: false`, only keys matching a pattern survive:
  // others are rejected (strict) or stripped (coerce). Start from an empty
  // object rather than spreading every input key.
  const strictKeys = hasAdditionalProperties(schema) && schema.additionalProperties === false
  if (strictKeys) {
    const loopLines: string[] = [`    if (/${escapedPattern}/.test(key)) {`]
    if (patternAssignment) {
      loopLines.push(`      const value = input[key];`)
      loopLines.push(`      ${patternAssignment}`)
    }
    loopLines.push(`      continue;`)
    loopLines.push(`    }`)
    const keepConditions = patterns.slice(1).map(([p]) => `/${escapeRegexPattern(p)}/.test(key)`)
    if (keepConditions.length > 0) {
      loopLines.push(`    if (${keepConditions.join(' || ')}) {`)
      loopLines.push(`      (result as Record<string, unknown>)[key] = input[key];`)
      loopLines.push(`      continue;`)
      loopLines.push(`    }`)
    }
    if (strict) loopLines.push(`    throw new Error(\`[${typeName}] unknown property "\${key}"\`);`)

    return `export const ${functionName} = (input: unknown): ${typeName} => {
  if (!isObject(input)) {
${notObjectBranch}
  }
  const result = {} as unknown as ${typeName};
  for (const key in input) {
${loopLines.join('\n')}
  }
  return result;
};`
  }

  // Generate a parser that handles both pattern matching and x- extensions
  return `export const ${functionName} = (input: unknown): ${typeName} => {
  if (!isObject(input)) {
${notObjectBranch}
  }
  const result = {
    ...input,
  } as unknown as ${typeName};
  for (const key in input) {
    if (/${escapedPattern}/.test(key)) {
      const value = input[key];
      ${patternAssignment}
    }
  }
  return result;
};`
}

/**
 * Generates a parser for conditional schemas with if/then/else.
 * This always generates parser calls regardless of useRefImports setting,
 * because conditional logic requires delegating to the appropriate parser.
 */
const generateConditionalParser = (
  schema: JSONSchema.Object,
  typeName: string,
  suffix: string,
  stripUnknown = false,
  caseInsensitive = false,
): string => {
  const functionName = generateParserName(typeName)

  // Extract the condition and branches
  const ifSchema = schema.if
  const thenSchema = schema.then
  const elseSchema = schema.else

  // Check if branches are defined and have $ref
  const thenHasRef = thenSchema && isSchemaObject(thenSchema) && hasRef(thenSchema)
  const elseHasRef = elseSchema && isSchemaObject(elseSchema) && hasRef(elseSchema)

  if (!thenHasRef || !elseHasRef) {
    // Non-$ref branches (e.g. if/then/else providing defaults for properties).
    // Flatten all three branches into a single object schema and generate a
    // regular object parser from the merged property set.
    const mergedSchema = getConditionalObjectSchema(schema)
    if (mergedSchema) {
      return generateObjectParser(
        mergedSchema,
        typeName,
        false,
        suffix,
        false,
        false,
        true,
        stripUnknown,
        undefined,
        NO_RESERVED_NAMES,
        caseInsensitive,
      )
    }
    return generateEmptyObjectParser(typeName)
  }

  // Check if the condition is checking for $ref property
  const isRefCondition =
    ifSchema &&
    isSchemaObject(ifSchema) &&
    'required' in ifSchema &&
    Array.isArray(ifSchema.required) &&
    ifSchema.required.includes('$ref')

  if (!isRefCondition) {
    // Condition is not a $ref check — flatten into an object parser
    const mergedSchema = getConditionalObjectSchema(schema)
    if (mergedSchema) {
      return generateObjectParser(
        mergedSchema,
        typeName,
        false,
        suffix,
        false,
        false,
        true,
        stripUnknown,
        undefined,
        NO_RESERVED_NAMES,
        caseInsensitive,
      )
    }
    return generateEmptyObjectParser(typeName)
  }

  const thenRef = thenSchema.$ref
  const elseRef = elseSchema.$ref

  const thenParserName = generateParserName(refToName(thenRef, suffix))
  const elseParserName = generateParserName(refToName(elseRef, suffix))
  const thenTypeName = refToName(thenRef, suffix)

  return `export const ${functionName} = (input: unknown): ${typeName} | ${thenTypeName} =>
  hasRef(input) ? ${thenParserName}(input) : ${elseParserName}(input)
      `
}

/**
 * Builds an object schema from conditional if/then keywords when the schema does not
 * declare type: "object". Flattens if/then/else property sets into a single object schema.
 */
const getConditionalObjectSchema = (schema: JSONSchema): JSONSchema.Object | null => {
  if (!isSchemaObject(schema)) {
    return null
  }

  if (!('if' in schema) || !('then' in schema)) {
    return null
  }

  const ifSchema = schema.if
  const thenSchema = schema.then
  const elseSchema = 'else' in schema ? schema.else : undefined

  if (!isSchemaObject(ifSchema) || !isSchemaObject(thenSchema)) {
    return null
  }

  const ifProperties = ifSchema.properties
  const thenProperties = thenSchema.properties
  const elseProperties = elseSchema && isSchemaObject(elseSchema) ? elseSchema.properties : undefined
  const hasIfProperties = ifProperties && typeof ifProperties === 'object'
  const hasThenProperties = thenProperties && typeof thenProperties === 'object'
  const hasElseProperties = elseProperties && typeof elseProperties === 'object'

  if (!hasIfProperties && !hasThenProperties && !hasElseProperties) {
    return null
  }

  const required = new Set<string>()

  if (Array.isArray(ifSchema.required)) {
    for (const key of ifSchema.required) {
      required.add(key)
    }
  }

  // If the `if` condition checks for a `const` value on a property, that property
  // is effectively required (the schema only applies when the condition is true).
  if (hasIfProperties && ifProperties && typeof ifProperties === 'object') {
    for (const [key, propSchema] of Object.entries(ifProperties as Record<string, JSONSchema>)) {
      if (isSchemaObject(propSchema) && hasConst(propSchema)) {
        required.add(key)
      }
    }
  }

  if (Array.isArray(thenSchema.required)) {
    for (const key of thenSchema.required) {
      required.add(key)
    }
  }

  return {
    type: 'object',
    properties: {
      // else properties first so then properties take precedence on overlap
      ...(hasElseProperties ? elseProperties : {}),
      ...(hasIfProperties ? ifProperties : {}),
      ...(hasThenProperties ? thenProperties : {}),
    },
    ...(required.size > 0 ? { required: Array.from(required) } : {}),
  }
}

/**
 * Generates a parser for SchemaObject that validates all JSON Schema 2020-12 properties.
 * This handles the special case where a schema can be any valid JSON Schema.
 */
const generateSchemaObjectParser = (typeName: string): string => {
  const functionName = generateParserName(typeName)

  return `export const ${functionName} = (input: unknown): ${typeName} => {
  if (typeof input === 'boolean') {
    return input as ${typeName};
  }
  
  if (!isObject(input)) {
    return {} as ${typeName};
  }
  
  return input as ${typeName};
};`
}

/**
 * Determines the appropriate parser generation strategy for a schema.
 */
const selectParserStrategy = (schema: JSONSchema, typeName: string, options?: GenerateParserOptions): string => {
  const useRefImports = options?.useRefImports ?? false
  const logWarnings = options?.logWarnings ?? false
  const strict = options?.strict ?? false
  const stripUnknown = options?.stripUnknown ?? false
  const caseInsensitive = options?.caseInsensitive ?? false
  const suffix = options?.typeSuffix ?? ''

  // Special case for the self-referential JSON Schema meta-schema type (e.g.
  // `Schema` / `SchemaObject`) - it can be any JSON Schema. This is an OpenAPI
  // heuristic for a `$defs`/`components.schemas` entry named `schema`; it must
  // never fire for the root document, whose name is user-derived (a `schema.json`
  // file naturally yields the root type `Schema`) and would otherwise collapse
  // to a validation-free pass-through parser.
  if (!options?.isRoot && typeName === `Schema${suffix}`) {
    return generateSchemaObjectParser(typeName)
  }

  const isObjectLikeSchema =
    isObjectSchema(schema) ||
    (isSchemaObject(schema) && ('patternProperties' in schema || 'additionalProperties' in schema))

  // Handle non-object schemas with type-appropriate validation
  if (!isObjectLikeSchema && !isSchemaObject(schema)) {
    return generateNonObjectParser(typeName, schema, strict, {
      useRefImports,
      suffix,
      stripUnknown,
      caseInsensitive,
      logWarnings,
      ...(options?.rootSchema !== undefined ? { rootSchema: options.rootSchema } : {}),
      ...(options?.reservedNames !== undefined ? { reservedNames: options.reservedNames } : {}),
    })
  }

  // Handle schemas with both properties AND patternProperties.
  // This generates a parser that handles known properties and also iterates
  // pattern-matched keys (e.g. responses with "default" + "200", "4XX").
  if (hasProperties(schema) && isSchemaObject(schema) && 'patternProperties' in schema) {
    return generateCombinedObjectParser(
      schema,
      typeName,
      useRefImports,
      suffix,
      logWarnings,
      strict,
      stripUnknown,
      caseInsensitive,
    )
  }

  // Handle schemas that have explicit properties — generate a full object parser.
  // This intentionally runs before if/then checks so that schemas with both
  // properties AND conditional keywords use all declared properties rather than
  // only the if/then fragment.
  if (hasProperties(schema)) {
    return generateObjectParser(
      schema,
      typeName,
      useRefImports,
      suffix,
      logWarnings,
      strict,
      true,
      stripUnknown,
      options?.rootSchema,
      options?.reservedNames,
      caseInsensitive,
    )
  }

  // Handle conditional schemas (if/then/else) for schemas without explicit properties.
  if (isSchemaObject(schema) && 'if' in schema && 'then' in schema && 'else' in schema) {
    return generateConditionalParser(schema as JSONSchema.Object, typeName, suffix, stripUnknown, caseInsensitive)
  }

  // Handle conditional schemas that only define if/then object fragments.
  // We flatten the fragments into a regular object parser.
  const conditionalObjectSchema = getConditionalObjectSchema(schema)
  if (conditionalObjectSchema) {
    return generateObjectParser(
      conditionalObjectSchema,
      typeName,
      useRefImports,
      suffix,
      logWarnings,
      strict,
      true,
      stripUnknown,
      undefined,
      NO_RESERVED_NAMES,
      caseInsensitive,
    )
  }

  // Handle non-object schemas with type-appropriate validation (no properties, no conditionals)
  if (!isObjectLikeSchema) {
    return generateNonObjectParser(typeName, schema, strict, {
      useRefImports,
      suffix,
      stripUnknown,
      caseInsensitive,
      logWarnings,
      ...(options?.rootSchema !== undefined ? { rootSchema: options.rootSchema } : {}),
      ...(options?.reservedNames !== undefined ? { reservedNames: options.reservedNames } : {}),
    })
  }

  // Handle schemas with patternProperties (but no properties)
  if ('patternProperties' in schema) {
    return generatePatternPropertiesParser(schema as JSONSchema.Object, typeName, useRefImports, suffix, strict)
  }

  // Handle schemas with additionalProperties as true or false (but no properties)
  if ('additionalProperties' in schema && !hasProperties(schema)) {
    const additionalProps = schema.additionalProperties

    // If additionalProperties is true or false, validate it is an object
    if (additionalProps === true || additionalProps === false) {
      return generateEmptyObjectParser(typeName, strict)
    }

    // Otherwise, handle as a schema (could be a $ref or object schema)
    return generateAdditionalPropertiesParser(schema as JSONSchema.Object, typeName, useRefImports, suffix, strict)
  }

  // Handle empty object schemas
  if ('type' in schema && schema.type === 'object' && !hasProperties(schema)) {
    return generateEmptyObjectParser(typeName, strict)
  }

  // Default fallback - validate it is an object since we passed the isObjectSchema check
  return generateEmptyObjectParser(typeName, strict)
}

/**
 * Generates a safe parser as an arrow function that never throws.
 * The parser provides default values for all missing or invalid fields.
 *
 * When useRefImports is enabled, properties with $ref will call the imported
 * parser function (e.g., parseContact(input?.contact)) instead of inlining
 * the resolved schema's validation logic. Array properties whose items are a
 * $ref will map each element through the imported parser.
 */
export const generateParserFunction = (
  schema: JSONSchema,
  typeName: string,
  options?: GenerateParserOptions,
): string => {
  return selectParserStrategy(schema, typeName, options)
}

/**
 * Returns the predicate function name for a generated shape validator.
 * @example shapeValidatorFunctionName('CustomerObject') // 'validateCustomerObjectShape'
 */
export const shapeValidatorFunctionName = (typeName: string): string => shapeValidatorName(typeName)

/**
 * Generates a `validate{TypeName}Shape(input)` predicate that returns true
 * iff `input` already matches the shape produced by the parser's fast path —
 * i.e. the parser would return `{ ...input } as TypeName` without coercion.
 *
 * Parents call this predicate to fast-path through nested ref properties
 * (and arrays of refs) without recursing into their parser.
 *
 * Returns a stub that always returns `false` for schemas that cannot be
 * predicated (composition, conditionals, pattern properties, complex refs
 * in additionalProperties). The stub is safe: parents calling it will fall
 * through to the slow path, matching the pre-deep-fast-path behavior.
 */
export const generateShapeValidator = (
  schema: JSONSchema,
  typeName: string,
  useRefImports: boolean,
  suffix = '',
  exported = true,
  stripUnknown = false,
  reservedNames: ReadonlySet<string> = NO_RESERVED_NAMES,
): string => {
  const fnName = shapeValidatorName(typeName)
  const exportPrefix = exported ? 'export ' : ''
  const stub = `${exportPrefix}const ${fnName} = (_input: unknown): boolean => false;`

  if (!isSchemaObject(schema)) return stub

  // An alias definition (a bare `$ref` with no shape of its own) delegates to
  // the referenced type's validator. Guarded against self-reference.
  if (useRefImports && hasRef(schema) && !hasProperties(schema)) {
    const refName = refToName((schema as { $ref: string }).$ref, suffix)
    if (refName !== typeName) {
      return `${exportPrefix}const ${fnName} = (input: unknown): boolean => ${shapeValidatorName(refName)}(input);`
    }
    return stub
  }

  // A pure union definition (file-level oneOf/anyOf without properties) gets a
  // real membership predicate when every branch is checkable. A recursive
  // union (e.g. `expr` whose branches $ref `expr` itself) works because the
  // branch checks call this very validator by name at runtime. Skipped under
  // stripUnknown: the branch checks carry no known-keys terms, so a `true`
  // could not guarantee the parser's strip build would be a no-op.
  if (!hasProperties(schema) && !('patternProperties' in schema) && !('if' in schema) && !stripUnknown) {
    const branches = getUnionBranches(schema)
    if (branches) {
      const check = generateUnionCheck('input', branches, useRefImports, suffix)
      if (check !== null) {
        return `${exportPrefix}const ${fnName} = (input: unknown): boolean => ${check};`
      }
    }
    return stub
  }

  if (!hasProperties(schema)) return stub

  // Composition / conditional schemas can match in many shapes — bail.
  if (
    hasOneOf(schema) ||
    hasAnyOf(schema) ||
    hasAllOf(schema) ||
    'not' in schema ||
    'patternProperties' in schema ||
    'if' in schema ||
    'then' in schema ||
    'else' in schema
  ) {
    return stub
  }

  const schemaProps = (schema as { properties: Record<string, JSONSchema> }).properties
  const propertyKeys = Object.keys(schemaProps)
  // Same deterministic naming as the parser's sub-parser generation, so the
  // referenced private shape predicates exist in the same file.
  const { objects: subTypeNames, arrayItems: subItemNames } = collectInlineSubTypes(schema, typeName, reservedNames)
  // When the parser strips extras (additionalProperties: false or stripUnknown),
  // an input carrying an undeclared key is *not* fast-path eligible — the parser
  // would strip it rather than return `{ ...input }` — so the shape only matches
  // when every key is declared. With every declared property required, the
  // no-extras test is the cheaper own-key count appended after the typed checks
  // (which prove all N keys present); otherwise it is the `_hasOnlyKnownKeys`
  // walk the parser emits under the same `stripKeys` condition.
  const validatorStripKeys = hasStrictKeys(schema) || stripUnknown
  const validatorKeyCount = validatorStripKeys ? exactKeyCountOf(schema) : null
  const strictKeysGuard =
    validatorStripKeys && validatorKeyCount === null
      ? `\n  if (!_hasOnlyKnownKeys${typeName}(input)) return false;`
      : ''
  const checks: string[] = []

  for (const key of propertyKeys) {
    const propSchema = schemaProps[key] as JSONSchema
    // Records of refs require iterating every value — too expensive for the fast path.
    if (shouldUseRecordRefImport(propSchema, useRefImports)) {
      return stub
    }

    const accessor = safeAccessor('input', key)
    const isRequired = isPropertyRequired(key, schema)
    const subName = subTypeNames.get(key)
    let check = subName
      ? `${shapeValidatorName(subName)}(${accessor})`
      : generatePropertyTypeCheck(accessor, propSchema, useRefImports, suffix)
    // Arrays of inline objects prove every element via the private item loop
    // helper (emitted alongside the item sub-parser), matching the parser's
    // fast-path guard.
    const itemSubName = subItemNames.get(key)
    if (check !== null && itemSubName) {
      check = `${check} && _every${itemSubName}(${accessor})`
    }
    if (check === null) {
      return stub
    }

    if (isRequired) {
      checks.push(check)
    } else {
      checks.push(`(${accessor} === undefined || ${check})`)
    }
  }

  // The count form is sound only in conjunction with the typed checks above
  // (they prove every declared key present) and only for plain objects (a
  // crafted prototype could satisfy those checks through inherited
  // properties), so it joins the chain last, prototype-guarded like the
  // parser's own fast path.
  if (validatorKeyCount !== null) {
    checks.push(
      `Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === ${validatorKeyCount}`,
    )
  }

  if (checks.length === 0) {
    if (strictKeysGuard) {
      return `${exportPrefix}const ${fnName} = (input: unknown): boolean => {
  if (!isObject(input)) return false;${strictKeysGuard}
  return true;
};`
    }
    return `${exportPrefix}const ${fnName} = (input: unknown): boolean => isObject(input);`
  }

  let body = checks[0] as string
  for (let i = 1; i < checks.length; i++) {
    body += '\n    && ' + checks[i]
  }

  return `${exportPrefix}const ${fnName} = (input: unknown): boolean => {
  if (!isObject(input)) return false;${strictKeysGuard}
  return ${body};
};`
}
