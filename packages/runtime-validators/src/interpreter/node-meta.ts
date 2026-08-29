/**
 * The keywords of one schema node, read once and kept.
 *
 * The interpreter walks the schema afresh for every value, and it used to ask
 * the node for each keyword it might carry on every one of those walks — around
 * two dozen `Object.hasOwn` + dynamic-key reads per node, per validation. On a
 * 40-property object that is ~1000 lookups to discover, over and over, that
 * almost every keyword is absent: a CPU profile of the steady-state benchmark
 * put 31% of the whole run inside that one reader.
 *
 * A schema node cannot change its own keywords between two validations, so the
 * answer is derived once and memoized on the node. Two things make it a win
 * rather than a wash:
 *
 *   1. **Building it is cheaper than one old scan.** We walk the node's *own
 *      keys* (typically three or four) through a `switch`, instead of asking
 *      about every keyword that could exist. So even a schema validated exactly
 *      once — the cold one-shot path this package optimizes for — comes out
 *      ahead, measured at ~6x the old per-visit scan.
 *   2. **Reading it is a monomorphic field load.** Every node produces the same
 *      object shape, so `meta.type` compiles to a fixed-offset load instead of
 *      the megamorphic dictionary lookup `schema[keyword]` has to be.
 *
 * Values are also *narrowed* here — `minLength` is a `number | undefined`
 * rather than `unknown` — so the per-validation `typeof` guards move off the hot
 * path too.
 *
 * ## Why the keywords are grouped
 *
 * This was one flat object of 64 fields, and the engine pays for a field whether
 * or not the node declares it: a `{ type: 'string', minLength: 1 }` node — the
 * overwhelmingly common shape — allocated 64 slots to hold two answers and 62
 * `undefined`s. Measured on JSC, that is **662 bytes per node**, and the meta is
 * retained for the life of the prepared validator, so a document like the
 * AsyncAPI 3.0 meta-schema (2351 schema nodes) carried ~1.5 MB of mostly-empty
 * objects.
 *
 * So the per-vocabulary keywords now live in sub-objects that are built **only
 * when the node declares one of them** — the same trick `ObjectMeta` in
 * `interpret.ts` already plays, and the same one Zod 4.5 used to shrink a schema
 * instance ~10x: stop materializing what this instance will never be asked for.
 * Averaged over that document's nodes the meta now costs **132 bytes** (5x
 * smaller), and the document ~300 KB.
 *
 * It costs the hot path nothing, because the walker was *already* gated on a
 * `has…Keywords` boolean before it read any of these fields — the group pointer
 * is that boolean, `null` where the flag was `false`. So the flag test becomes a
 * null check on the same fixed-offset load, and only the branch that already
 * passed it pays one extra hop. Each group is built at exactly one site, so all
 * of them share a hidden class and stay monomorphic to read. Steady-state
 * throughput measured unchanged; the *cold* one-shot path — the one this package
 * exists for — got faster, because a node no longer initializes 64 slots to
 * answer two questions (the 40-property benchmark's schema-to-first-result went
 * 0.063 ms → 0.045 ms).
 *
 * Keys come from `Object.getOwnPropertyNames`, not `Object.keys`, so this reads
 * exactly what `Object.hasOwn` used to: own properties only — never an inherited
 * name off a polluted `Object.prototype`, which is the bug the old reader
 * existed to prevent — including a non-enumerable one.
 */

/**
 * The three reference keywords. Present when the node carries any of them, which
 * most nodes do not.
 */
export type RefKeywords = {
  /** `$ref`, when it is a string — the only form that resolves. */
  readonly ref: string | undefined
  /** `$dynamicRef`, when it is a string. */
  readonly dynamicRef: string | undefined
  /** True when a string `$recursiveRef` (2019-09) is present. */
  readonly hasRecursiveRef: boolean
}

/**
 * The branching applicators. Present when the node declares `allOf`, `anyOf`,
 * `oneOf`, `not`, or `if` — a `then`/`else` with no `if` asserts nothing, so it
 * does not open the group on its own.
 */
export type BranchKeywords = {
  readonly allOf: readonly unknown[] | undefined
  /** `anyOf`, when a non-empty array — an empty one asserts nothing. */
  readonly anyOf: readonly unknown[] | undefined
  /** `oneOf`, when a non-empty array — see {@link BranchKeywords.anyOf}. */
  readonly oneOf: readonly unknown[] | undefined
  readonly hasNot: boolean
  readonly not: unknown
  readonly hasIf: boolean
  readonly ifSchema: unknown
  readonly hasThen: boolean
  readonly thenSchema: unknown
  readonly hasElse: boolean
  readonly elseSchema: unknown
}

/** `unevaluatedProperties` / `unevaluatedItems` — the keywords that open an annotation scope. */
export type UnevaluatedKeywords = {
  readonly hasProperties: boolean
  readonly properties: unknown
  readonly hasItems: boolean
  readonly items: unknown
}

/** The string constraints. */
export type StringKeywords = {
  readonly minLength: number | undefined
  readonly maxLength: number | undefined
  readonly pattern: string | undefined
  readonly format: string | undefined
}

/** The numeric constraints. */
export type NumberKeywords = {
  readonly minimum: number | undefined
  readonly maximum: number | undefined
  readonly exclusiveMinimum: number | undefined
  readonly exclusiveMaximum: number | undefined
  /** Draft-04's boolean `exclusiveMinimum: true`, which makes a sibling `minimum` strict. */
  readonly strictMinimum: boolean
  /** Draft-04's boolean `exclusiveMaximum: true` — see {@link NumberKeywords.strictMinimum}. */
  readonly strictMaximum: boolean
  readonly multipleOf: number | undefined
}

/** The array keywords. */
export type ArrayKeywords = {
  readonly minItems: number | undefined
  readonly maxItems: number | undefined
  readonly uniqueItems: boolean
  /**
   * The positional schemas: `prefixItems`, or draft-07's array-form `items`.
   * Undefined when the node declares neither.
   */
  readonly tuple: readonly unknown[] | undefined
  /**
   * The schema for everything past {@link ArrayKeywords.tuple}: `items` next to a
   * `prefixItems`, `additionalItems` next to an array-form `items`, or a plain
   * schema-form `items` on its own.
   */
  readonly rest: unknown
  readonly hasContains: boolean
  readonly contains: unknown
  readonly minContains: number | undefined
  readonly maxContains: number | undefined
}

/** The object keywords. */
export type ObjectKeywords = {
  readonly properties: Record<string, unknown> | undefined
  readonly patternProperties: Record<string, unknown> | undefined
  readonly required: readonly string[] | undefined
  readonly dependentRequired: Record<string, unknown> | undefined
  readonly dependentSchemas: Record<string, unknown> | undefined
  /** Draft-07 `dependencies`, the dual-form predecessor of the two keywords above. */
  readonly dependencies: Record<string, unknown> | undefined
  readonly hasAdditionalProperties: boolean
  readonly additionalProperties: unknown
  readonly minProperties: number | undefined
  readonly maxProperties: number | undefined
  readonly hasPropertyNames: boolean
  readonly propertyNames: unknown
}

export type NodeMeta = {
  /** True when the node declares a string `$id`, opening a new schema resource. */
  readonly hasId: boolean
  /** OpenAPI 3.0 `nullable: true`, which accepts `null` regardless of `type`. */
  readonly nullable: boolean

  /**
   * Presence of `const`, kept separate from its value: `const: undefined` is a
   * legal schema asserting the value is `undefined`, so absence cannot be read
   * off the value alone.
   */
  readonly hasConst: boolean
  readonly constValue: unknown
  /** `enum`, when it is an array. */
  readonly enumValues: readonly unknown[] | undefined

  /** `type`, when a single string. */
  readonly type: string | undefined
  /** `type`, when a non-empty array of strings. */
  readonly types: readonly string[] | undefined

  /** The reference keywords, or `null` when the node carries none — one test to skip all three. */
  readonly refs: RefKeywords | null
  /** The branching applicators, or `null` — one test to skip all five. */
  readonly branches: BranchKeywords | null
  /** The `unevaluated*` keywords, or `null`. */
  readonly unevaluated: UnevaluatedKeywords | null
  /** The string constraints, or `null`, so a string value can skip the block. */
  readonly strings: StringKeywords | null
  /** The numeric constraints, or `null`. */
  readonly numbers: NumberKeywords | null
  /** The array keywords, or `null`. */
  readonly arrays: ArrayKeywords | null
  /** The object keywords, or `null`. */
  readonly objects: ObjectKeywords | null
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The keywords of `schema`, from `cache` when it holds them and freshly built
 * otherwise.
 *
 * The cache belongs to the *prepared validator*, and it stays `null` until that
 * validator has been called more than once (see `prepare.ts`). Two reasons:
 *
 *   - A one-shot validation would never read back what it wrote. Building the
 *     meta is already cheaper than the keyword-by-keyword scan it replaces, so
 *     the cold path is better off skipping the write entirely.
 *   - A per-validator map stays small. A single module-level map accumulates an
 *     entry for every node of every schema ever validated, and a `WeakMap` write
 *     into a map that large costs about twice one into a small one.
 *
 * The narrowing here is exactly what the interpreter used to do inline, keyword
 * by keyword: a wrong-typed keyword (`minLength: "3"`) is not an assertion, so
 * it lands as `undefined` and the walker skips it, the same as before.
 */
export const getNodeMeta = (cache: WeakMap<object, NodeMeta> | null, schema: Record<string, unknown>): NodeMeta => {
  if (cache !== null) {
    const cached = cache.get(schema)
    if (cached !== undefined) return cached
  }

  let hasId = false
  let nullable = false
  let ref: string | undefined
  let dynamicRef: string | undefined
  let hasRecursiveRef = false
  let hasConst = false
  let constValue: unknown
  let enumValues: readonly unknown[] | undefined
  let type: string | undefined
  let types: readonly string[] | undefined
  let allOf: readonly unknown[] | undefined
  let anyOf: readonly unknown[] | undefined
  let oneOf: readonly unknown[] | undefined
  let hasNot = false
  let not: unknown
  let hasIf = false
  let ifSchema: unknown
  let hasThen = false
  let thenSchema: unknown
  let hasElse = false
  let elseSchema: unknown
  let hasUnevaluatedProperties = false
  let unevaluatedProperties: unknown
  let hasUnevaluatedItems = false
  let unevaluatedItems: unknown
  let minLength: number | undefined
  let maxLength: number | undefined
  let pattern: string | undefined
  let format: string | undefined
  let minimum: number | undefined
  let maximum: number | undefined
  let exclusiveMinimum: number | undefined
  let exclusiveMaximum: number | undefined
  let strictMinimum = false
  let strictMaximum = false
  let multipleOf: number | undefined
  let minItems: number | undefined
  let maxItems: number | undefined
  let uniqueItems = false
  let prefixItems: readonly unknown[] | undefined
  let itemsRaw: unknown
  let hasItems = false
  let additionalItems: unknown
  let hasContains = false
  let contains: unknown
  let minContains: number | undefined
  let maxContains: number | undefined
  let properties: Record<string, unknown> | undefined
  let patternProperties: Record<string, unknown> | undefined
  let required: readonly string[] | undefined
  let dependentRequired: Record<string, unknown> | undefined
  let dependentSchemas: Record<string, unknown> | undefined
  let dependencies: Record<string, unknown> | undefined
  let hasAdditionalProperties = false
  let additionalProperties: unknown
  let minProperties: number | undefined
  let maxProperties: number | undefined
  let hasPropertyNames = false
  let propertyNames: unknown

  for (const key of Object.getOwnPropertyNames(schema)) {
    const value = schema[key]
    switch (key) {
      case '$id':
        hasId = typeof value === 'string'
        break
      case 'nullable':
        nullable = value === true
        break
      case '$ref':
        if (typeof value === 'string') ref = value
        break
      case '$dynamicRef':
        if (typeof value === 'string') dynamicRef = value
        break
      case '$recursiveRef':
        hasRecursiveRef = typeof value === 'string'
        break
      case 'const':
        hasConst = true
        constValue = value
        break
      case 'enum':
        if (Array.isArray(value)) enumValues = value
        break
      case 'type':
        if (typeof value === 'string') type = value
        else if (Array.isArray(value) && value.length > 0) types = value as string[]
        break
      case 'allOf':
        if (Array.isArray(value)) allOf = value
        break
      case 'anyOf':
        if (Array.isArray(value) && value.length > 0) anyOf = value
        break
      case 'oneOf':
        if (Array.isArray(value) && value.length > 0) oneOf = value
        break
      case 'not':
        hasNot = true
        not = value
        break
      case 'if':
        hasIf = true
        ifSchema = value
        break
      case 'then':
        hasThen = true
        thenSchema = value
        break
      case 'else':
        hasElse = true
        elseSchema = value
        break
      case 'unevaluatedProperties':
        hasUnevaluatedProperties = true
        unevaluatedProperties = value
        break
      case 'unevaluatedItems':
        hasUnevaluatedItems = true
        unevaluatedItems = value
        break
      case 'minLength':
        if (typeof value === 'number') minLength = value
        break
      case 'maxLength':
        if (typeof value === 'number') maxLength = value
        break
      case 'pattern':
        if (typeof value === 'string') pattern = value
        break
      case 'format':
        if (typeof value === 'string') format = value
        break
      case 'minimum':
        if (typeof value === 'number') minimum = value
        break
      case 'maximum':
        if (typeof value === 'number') maximum = value
        break
      case 'exclusiveMinimum':
        if (typeof value === 'number') exclusiveMinimum = value
        else if (value === true) strictMinimum = true
        break
      case 'exclusiveMaximum':
        if (typeof value === 'number') exclusiveMaximum = value
        else if (value === true) strictMaximum = true
        break
      case 'multipleOf':
        if (typeof value === 'number') multipleOf = value
        break
      case 'minItems':
        if (typeof value === 'number') minItems = value
        break
      case 'maxItems':
        if (typeof value === 'number') maxItems = value
        break
      case 'uniqueItems':
        uniqueItems = value === true
        break
      case 'prefixItems':
        if (Array.isArray(value)) prefixItems = value
        break
      case 'items':
        hasItems = true
        itemsRaw = value
        break
      case 'additionalItems':
        additionalItems = value
        break
      case 'contains':
        hasContains = true
        contains = value
        break
      case 'minContains':
        if (typeof value === 'number') minContains = value
        break
      case 'maxContains':
        if (typeof value === 'number') maxContains = value
        break
      case 'properties':
        if (isPlainObject(value)) properties = value
        break
      case 'patternProperties':
        if (isPlainObject(value)) patternProperties = value
        break
      case 'required':
        if (Array.isArray(value)) required = value as string[]
        break
      case 'dependentRequired':
        if (isPlainObject(value)) dependentRequired = value
        break
      case 'dependentSchemas':
        if (isPlainObject(value)) dependentSchemas = value
        break
      case 'dependencies':
        if (isPlainObject(value)) dependencies = value
        break
      case 'additionalProperties':
        hasAdditionalProperties = true
        additionalProperties = value
        break
      case 'minProperties':
        if (typeof value === 'number') minProperties = value
        break
      case 'maxProperties':
        if (typeof value === 'number') maxProperties = value
        break
      case 'propertyNames':
        hasPropertyNames = true
        propertyNames = value
        break
      default:
        break
    }
  }

  // `prefixItems` wins when both are present (2020-12), otherwise an array-form
  // `items` is itself the tuple and `additionalItems` covers the tail (draft-07).
  // Resolved here, after the walk, because it depends on three keywords whose
  // order in the object says nothing.
  let tuple: readonly unknown[] | undefined
  let rest: unknown
  if (prefixItems !== undefined) {
    tuple = prefixItems
    rest = itemsRaw
  } else if (Array.isArray(itemsRaw)) {
    tuple = itemsRaw
    rest = additionalItems
  } else {
    rest = itemsRaw
  }

  const meta: NodeMeta = {
    hasId,
    nullable,
    hasConst,
    constValue,
    enumValues,
    type,
    types,
    refs:
      ref !== undefined || dynamicRef !== undefined || hasRecursiveRef ? { ref, dynamicRef, hasRecursiveRef } : null,
    branches:
      allOf !== undefined || anyOf !== undefined || oneOf !== undefined || hasNot || hasIf
        ? {
            allOf,
            anyOf,
            oneOf,
            hasNot,
            not,
            hasIf,
            ifSchema,
            hasThen,
            thenSchema,
            hasElse,
            elseSchema,
          }
        : null,
    unevaluated:
      hasUnevaluatedProperties || hasUnevaluatedItems
        ? {
            hasProperties: hasUnevaluatedProperties,
            properties: unevaluatedProperties,
            hasItems: hasUnevaluatedItems,
            items: unevaluatedItems,
          }
        : null,
    strings:
      minLength !== undefined || maxLength !== undefined || pattern !== undefined || format !== undefined
        ? { minLength, maxLength, pattern, format }
        : null,
    numbers:
      minimum !== undefined ||
      maximum !== undefined ||
      exclusiveMinimum !== undefined ||
      exclusiveMaximum !== undefined ||
      multipleOf !== undefined
        ? {
            minimum,
            maximum,
            exclusiveMinimum,
            exclusiveMaximum,
            strictMinimum,
            strictMaximum,
            multipleOf,
          }
        : null,
    arrays:
      minItems !== undefined || maxItems !== undefined || uniqueItems || tuple !== undefined || hasItems || hasContains
        ? {
            minItems,
            maxItems,
            uniqueItems,
            tuple,
            rest,
            hasContains,
            contains,
            minContains,
            maxContains,
          }
        : null,
    objects:
      properties !== undefined ||
      patternProperties !== undefined ||
      required !== undefined ||
      dependentRequired !== undefined ||
      dependentSchemas !== undefined ||
      dependencies !== undefined ||
      hasAdditionalProperties ||
      minProperties !== undefined ||
      maxProperties !== undefined ||
      hasPropertyNames
        ? {
            properties,
            patternProperties,
            required,
            dependentRequired,
            dependentSchemas,
            dependencies,
            hasAdditionalProperties,
            additionalProperties,
            minProperties,
            maxProperties,
            hasPropertyNames,
            propertyNames,
          }
        : null,
  }
  cache?.set(schema, meta)
  return meta
}
