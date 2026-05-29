import type { CompilerContext } from '#compiler/create-context'
import { FORMAT_CHECKS } from '#compiler/format-checks'
import { resolveLocalRef } from '#compiler/resolve-local-ref'

/**
 * Quotes a string as a JavaScript literal for embedding in generated source.
 */
const lit = (value: string): string => JSON.stringify(value)

/**
 * Appends a static path segment in the generated source. We build the JSON
 * Pointer at runtime by concatenating onto the parent path expression so the
 * same generator works whether the parent path is the empty-string literal or
 * a runtime variable.
 */
const joinStatic = (pathExpr: string, key: string): string => `${pathExpr}+${lit('/' + key)}`

/** Appends a dynamic (loop-variable) path segment in the generated source. */
const joinDynamic = (pathExpr: string, indexVar: string): string => `${pathExpr}+"/"+${indexVar}`

/** Returns a JS expression that is TRUE when `v` matches the given JSON type. */
const rightTypeExpr = (type: string, v: string): string => {
  switch (type) {
    case 'string':
      return `typeof ${v}==="string"`
    case 'number':
      return `typeof ${v}==="number"`
    case 'integer':
      return `Number.isInteger(${v})`
    case 'boolean':
      return `typeof ${v}==="boolean"`
    case 'null':
      return `${v}===null`
    case 'object':
      return `(typeof ${v}==="object"&&${v}!==null&&!Array.isArray(${v}))`
    case 'array':
      return `Array.isArray(${v})`
    default:
      // Unknown type keyword — treat as "always matches" so we never reject
      // valid data because of a type we do not model.
      return 'true'
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPrimitiveEnumValue = (value: unknown): boolean =>
  value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

/**
 * Generates (once) a boolean `(d) => boolean` function for a `$ref` target and
 * returns its name. Recursion terminates because the name is registered before
 * the body is generated, so a self-reference resolves to the same function.
 */
const ensureRefGuard = (ctx: CompilerContext, ref: string): string => {
  const entry = ctx.refs.get(ref) ?? {}
  if (entry.guardName) return entry.guardName

  const name = ctx.nextVar('refG')
  entry.guardName = name
  ctx.refs.set(ref, entry)

  const resolved = resolveLocalRef(ref, ctx.root)
  if (resolved === undefined) {
    throw new Error(`Cannot resolve $ref "${ref}". Only local refs into the same document are supported.`)
  }

  const savedEmit = ctx.emitErrors
  const savedFail = ctx.fail
  ctx.emitErrors = false
  ctx.fail = () => 'return false;'
  const body = generateSchemaCode(ctx, resolved, 'd', '""')
  ctx.emitErrors = savedEmit
  ctx.fail = savedFail

  ctx.refDecls.push(`function ${name}(d){${body}return true;}`)
  return name
}

/**
 * Generates (once) an error-collecting `(d, p, errs) => void` function for a
 * `$ref` target and returns its name. Mirrors {@link ensureRefGuard} but keeps
 * pushing into the shared `errs` array so errors inside refs stay detailed.
 */
const ensureRefError = (ctx: CompilerContext, ref: string): string => {
  const entry = ctx.refs.get(ref) ?? {}
  if (entry.errorName) return entry.errorName

  const name = ctx.nextVar('refE')
  entry.errorName = name
  ctx.refs.set(ref, entry)

  const resolved = resolveLocalRef(ref, ctx.root)
  if (resolved === undefined) {
    throw new Error(`Cannot resolve $ref "${ref}". Only local refs into the same document are supported.`)
  }

  const savedEmit = ctx.emitErrors
  const savedFail = ctx.fail
  ctx.emitErrors = true
  ctx.fail = (message, pathExpr) => `(errs||(errs=[])).push({message:${message},path:${pathExpr}});`
  const body = generateSchemaCode(ctx, resolved, 'd', 'p')
  ctx.emitErrors = savedEmit
  ctx.fail = savedFail

  // `errs` is closed over from factory scope, so the ref function only needs
  // the value and its base path.
  ctx.refDecls.push(`function ${name}(d,p){${body}}`)
  return name
}

/**
 * Generates code that validates a subschema in a pure boolean context, setting
 * `okVar = false` on any failure. Used for the branches of `anyOf` / `oneOf` /
 * `not` / `if`, where a failing branch is expected and must not pollute the
 * caller's error list.
 */
const generateBooleanBranch = (ctx: CompilerContext, schema: unknown, v: string, okVar: string): string => {
  const savedEmit = ctx.emitErrors
  const savedFail = ctx.fail
  ctx.emitErrors = false
  ctx.fail = () => `${okVar}=false;`
  const body = generateSchemaCode(ctx, schema, v, '""')
  ctx.emitErrors = savedEmit
  ctx.fail = savedFail
  return body
}

/**
 * Emits the object-applicator keywords (`properties`, `required`,
 * `patternProperties`, `additionalProperties`, `min/maxProperties`,
 * `dependentRequired`). Everything is wrapped in a single `typeof === object`
 * guard so the keywords stay inert for non-objects, matching JSON Schema
 * semantics and keeping unions cheap.
 */
const generateObjectKeywords = (
  ctx: CompilerContext,
  s: Record<string, unknown>,
  v: string,
  pathExpr: string,
): string => {
  const properties = isPlainObject(s['properties']) ? s['properties'] : undefined
  const patternProperties = isPlainObject(s['patternProperties']) ? s['patternProperties'] : undefined
  const hasAdditional = 'additionalProperties' in s
  const additional = s['additionalProperties']
  const required = Array.isArray(s['required']) ? (s['required'] as string[]) : []
  const dependentRequired = isPlainObject(s['dependentRequired']) ? s['dependentRequired'] : undefined
  const minProps = typeof s['minProperties'] === 'number' ? s['minProperties'] : undefined
  const maxProps = typeof s['maxProperties'] === 'number' ? s['maxProperties'] : undefined

  const needsLoop = patternProperties !== undefined || (hasAdditional && additional !== true)
  const requiredSet = new Set(required)

  const hasAnyObjectKeyword =
    properties !== undefined ||
    patternProperties !== undefined ||
    needsLoop ||
    required.length > 0 ||
    dependentRequired !== undefined ||
    minProps !== undefined ||
    maxProps !== undefined

  if (!hasAnyObjectKeyword) return ''

  const inner: string[] = []
  const knownKeys = properties ? Object.keys(properties) : []

  if (properties) {
    for (const key of knownKeys) {
      const propSchema = properties[key]
      const isRequired = requiredSet.has(key)
      const pv = ctx.nextVar()
      const sub = generateSchemaCode(ctx, propSchema, pv, joinStatic(pathExpr, key))

      if (!isRequired && sub.trim() === '') continue

      let block = `var ${pv}=${v}[${lit(key)}];`
      if (isRequired) {
        block += `if(${pv}===undefined){${ctx.fail(lit(`must have required property '${key}'`), pathExpr)}}`
        if (sub.trim() !== '') block += `else{${sub}}`
      } else {
        block += `if(${pv}!==undefined){${sub}}`
      }
      inner.push(block)
    }
  }

  // Required keys with no `properties` entry still need a presence check.
  for (const key of required) {
    if (properties && key in properties) continue
    inner.push(`if(${v}[${lit(key)}]===undefined){${ctx.fail(lit(`must have required property '${key}'`), pathExpr)}}`)
  }

  if (dependentRequired) {
    for (const [trigger, deps] of Object.entries(dependentRequired)) {
      if (!Array.isArray(deps)) continue
      const checks = (deps as string[])
        .map(
          (dep) =>
            `if(${v}[${lit(dep)}]===undefined){${ctx.fail(lit(`must have property '${dep}' when '${trigger}' is present`), pathExpr)}}`,
        )
        .join('')
      inner.push(`if(${v}[${lit(trigger)}]!==undefined){${checks}}`)
    }
  }

  if (needsLoop) {
    const k = ctx.nextVar('k')
    let loop = `for(var ${k} in ${v}){`

    if (knownKeys.length > 0) {
      const knownCond = knownKeys.map((kk) => `${k}===${lit(kk)}`).join('||')
      loop += `if(${knownCond})continue;`
    }

    const patternEntries = patternProperties ? Object.entries(patternProperties) : []
    if (patternEntries.length > 0) {
      const matched = ctx.nextVar('m')
      loop += `var ${matched}=false;`
      for (const [source, patternSchema] of patternEntries) {
        const reAcc = ctx.addHoist(new RegExp(source), `re:${source}`)
        const pv = ctx.nextVar()
        const sub = generateSchemaCode(ctx, patternSchema, pv, joinDynamic(pathExpr, k))
        loop += `if(${reAcc}.test(${k})){${matched}=true;`
        if (sub.trim() !== '') loop += `var ${pv}=${v}[${k}];${sub}`
        loop += `}`
      }
      if (hasAdditional && additional === false) {
        loop += `if(!${matched}){${ctx.fail(lit('must NOT have additional properties'), joinDynamic(pathExpr, k))}}`
      } else if (hasAdditional && isPlainObject(additional)) {
        const pv = ctx.nextVar()
        const sub = generateSchemaCode(ctx, additional, pv, joinDynamic(pathExpr, k))
        loop += `if(!${matched}){var ${pv}=${v}[${k}];${sub}}`
      }
    } else if (hasAdditional && additional === false) {
      loop += ctx.fail('"must NOT have additional properties"', joinDynamic(pathExpr, k))
    } else if (hasAdditional && isPlainObject(additional)) {
      const pv = ctx.nextVar()
      const sub = generateSchemaCode(ctx, additional, pv, joinDynamic(pathExpr, k))
      loop += `var ${pv}=${v}[${k}];${sub}`
    }

    loop += `}`
    inner.push(loop)
  }

  if (minProps !== undefined || maxProps !== undefined) {
    const cnt = ctx.nextVar('n')
    const ck = ctx.nextVar('k')
    inner.push(`var ${cnt}=0;for(var ${ck} in ${v})${cnt}++;`)
    if (minProps !== undefined) {
      inner.push(`if(${cnt}<${minProps}){${ctx.fail(lit(`must have at least ${minProps} properties`), pathExpr)}}`)
    }
    if (maxProps !== undefined) {
      inner.push(`if(${cnt}>${maxProps}){${ctx.fail(lit(`must have at most ${maxProps} properties`), pathExpr)}}`)
    }
  }

  if (inner.length === 0) return ''

  const isObj = ctx.nextVar('o')
  return `var ${isObj}=(typeof ${v}==="object"&&${v}!==null&&!Array.isArray(${v}));if(${isObj}){${inner.join('')}}`
}

/**
 * Emits the array-applicator keywords. Handles both the 2020-12 split
 * (`prefixItems` for the tuple head, `items` for the rest) and the draft-07
 * shape (`items` as an array tuple with `additionalItems` for the rest).
 */
const generateArrayKeywords = (
  ctx: CompilerContext,
  s: Record<string, unknown>,
  v: string,
  pathExpr: string,
): string => {
  const minItems = typeof s['minItems'] === 'number' ? s['minItems'] : undefined
  const maxItems = typeof s['maxItems'] === 'number' ? s['maxItems'] : undefined
  const uniqueItems = s['uniqueItems'] === true

  let tuple: unknown[] | undefined
  let rest: unknown
  if (Array.isArray(s['prefixItems'])) {
    tuple = s['prefixItems']
    rest = s['items']
  } else if (Array.isArray(s['items'])) {
    tuple = s['items']
    rest = s['additionalItems']
  } else {
    rest = s['items']
  }

  const hasArrayKeyword =
    minItems !== undefined || maxItems !== undefined || uniqueItems || tuple !== undefined || rest !== undefined

  if (!hasArrayKeyword) return ''

  const inner: string[] = []
  const start = tuple ? tuple.length : 0

  if (minItems !== undefined) {
    inner.push(`if(${v}.length<${minItems}){${ctx.fail(lit(`must have at least ${minItems} items`), pathExpr)}}`)
  }
  if (maxItems !== undefined) {
    inner.push(`if(${v}.length>${maxItems}){${ctx.fail(lit(`must have at most ${maxItems} items`), pathExpr)}}`)
  }

  if (tuple) {
    tuple.forEach((itemSchema, index) => {
      const pv = ctx.nextVar()
      const sub = generateSchemaCode(ctx, itemSchema, pv, joinStatic(pathExpr, String(index)))
      if (sub.trim() === '') return
      inner.push(`if(${v}.length>${index}){var ${pv}=${v}[${index}];${sub}}`)
    })
  }

  if (rest === false) {
    inner.push(`if(${v}.length>${start}){${ctx.fail(lit(`must NOT have more than ${start} items`), pathExpr)}}`)
  } else if (rest !== undefined && rest !== true) {
    const i = ctx.nextVar('i')
    const pv = ctx.nextVar()
    const sub = generateSchemaCode(ctx, rest, pv, joinDynamic(pathExpr, i))
    if (sub.trim() !== '') {
      inner.push(`for(var ${i}=${start};${i}<${v}.length;${i}++){var ${pv}=${v}[${i}];${sub}}`)
    }
  }

  if (uniqueItems) {
    ctx.needsUnique = true
    ctx.needsDeepEqual = true
    inner.push(`if(!unique(${v})){${ctx.fail(lit('must have unique items'), pathExpr)}}`)
  }

  if (inner.length === 0) return ''

  const isArr = ctx.nextVar('a')
  return `var ${isArr}=Array.isArray(${v});if(${isArr}){${inner.join('')}}`
}

/** Emits the string constraints under a single `typeof === string` guard. */
const generateStringKeywords = (
  ctx: CompilerContext,
  s: Record<string, unknown>,
  v: string,
  pathExpr: string,
): string => {
  const checks: string[] = []

  if (typeof s['minLength'] === 'number') {
    checks.push(
      `if(${v}.length<${s['minLength']}){${ctx.fail(lit(`must have at least ${s['minLength']} characters`), pathExpr)}}`,
    )
  }
  if (typeof s['maxLength'] === 'number') {
    checks.push(
      `if(${v}.length>${s['maxLength']}){${ctx.fail(lit(`must have at most ${s['maxLength']} characters`), pathExpr)}}`,
    )
  }
  if (typeof s['pattern'] === 'string') {
    const reAcc = ctx.addHoist(new RegExp(s['pattern']), `re:${s['pattern']}`)
    checks.push(`if(!${reAcc}.test(${v})){${ctx.fail(lit(`must match pattern ${s['pattern']}`), pathExpr)}}`)
  }
  if (typeof s['format'] === 'string') {
    const enabled = ctx.formats === 'all' || ctx.formats.has(s['format'])
    const re = FORMAT_CHECKS[s['format']]
    if (enabled && re) {
      const reAcc = ctx.addHoist(re, `fmt:${s['format']}`)
      checks.push(`if(!${reAcc}.test(${v})){${ctx.fail(lit(`must match format "${s['format']}"`), pathExpr)}}`)
    }
  }

  if (checks.length === 0) return ''
  return `if(typeof ${v}==="string"){${checks.join('')}}`
}

/** Emits the numeric constraints under a single `typeof === number` guard. */
const generateNumberKeywords = (
  ctx: CompilerContext,
  s: Record<string, unknown>,
  v: string,
  pathExpr: string,
): string => {
  const checks: string[] = []

  if (typeof s['minimum'] === 'number') {
    checks.push(`if(${v}<${s['minimum']}){${ctx.fail(lit(`must be >= ${s['minimum']}`), pathExpr)}}`)
  }
  if (typeof s['maximum'] === 'number') {
    checks.push(`if(${v}>${s['maximum']}){${ctx.fail(lit(`must be <= ${s['maximum']}`), pathExpr)}}`)
  }
  if (typeof s['exclusiveMinimum'] === 'number') {
    checks.push(`if(${v}<=${s['exclusiveMinimum']}){${ctx.fail(lit(`must be > ${s['exclusiveMinimum']}`), pathExpr)}}`)
  }
  if (typeof s['exclusiveMaximum'] === 'number') {
    checks.push(`if(${v}>=${s['exclusiveMaximum']}){${ctx.fail(lit(`must be < ${s['exclusiveMaximum']}`), pathExpr)}}`)
  }
  if (typeof s['multipleOf'] === 'number' && s['multipleOf'] > 0) {
    // Floating-point modulo is unreliable (0.3 % 0.1 !== 0), so divide and
    // measure the distance to the nearest integer instead.
    const q = ctx.nextVar('q')
    checks.push(
      `var ${q}=${v}/${s['multipleOf']};if(Math.abs(${q}-Math.round(${q}))>1e-8){${ctx.fail(lit(`must be a multiple of ${s['multipleOf']}`), pathExpr)}}`,
    )
  }

  if (checks.length === 0) return ''
  return `if(typeof ${v}==="number"){${checks.join('')}}`
}

/**
 * Generates a complete validation routine for a single (sub)schema against the
 * JavaScript expression `v`, writing failures via `ctx.fail`. This is the core
 * recursive emitter that every entry point and helper funnels through.
 */
export const generateSchemaCode = (ctx: CompilerContext, schema: unknown, v: string, pathExpr: string): string => {
  // Boolean schemas: `true`/`{}` accept everything, `false` rejects everything.
  if (schema === true) return ''
  if (schema === false) return ctx.fail(lit('must not be valid'), pathExpr)
  if (!isPlainObject(schema)) return ''

  const s = schema
  const code: string[] = []

  // OpenAPI 3.0 `nullable: true` — `null` is accepted regardless of the
  // declared `type` (or any other keyword). Ajv, as Loupe configures it, treats
  // a nullable schema this way, so a bare `null` must short-circuit the whole
  // subschema as valid; without this the `type` check alone produced a flood of
  // spurious "must be …" findings. We gate every emitted check on `!== null`
  // rather than only widening `type`, matching that "accepts null, full stop"
  // behaviour even when keywords like `enum`, `format`, or `$ref` are present.
  const nullable = s['nullable'] === true

  // $ref — delegate to a generated function (handles recursion). Sibling
  // keywords still apply per 2020-12, so we do not early-return.
  if (typeof s['$ref'] === 'string') {
    if (ctx.emitErrors) {
      const name = ensureRefError(ctx, s['$ref'])
      code.push(`${name}(${v},${pathExpr});`)
    } else {
      const name = ensureRefGuard(ctx, s['$ref'])
      code.push(`if(!${name}(${v})){${ctx.fail(lit('must match $ref schema'), pathExpr)}}`)
    }
  }

  // const / enum
  if ('const' in s) {
    const c = s['const']
    if (isPrimitiveEnumValue(c)) {
      code.push(`if(${v}!==${JSON.stringify(c)}){${ctx.fail(lit(`must be equal to ${JSON.stringify(c)}`), pathExpr)}}`)
    } else {
      ctx.needsDeepEqual = true
      const acc = ctx.addHoist(c, `const:${JSON.stringify(c)}`)
      code.push(`if(!deepEqual(${v},${acc})){${ctx.fail(lit('must be equal to the expected constant'), pathExpr)}}`)
    }
  }

  if (Array.isArray(s['enum'])) {
    const values = s['enum']
    const label = values.map((value) => JSON.stringify(value)).join(', ')
    if (values.every(isPrimitiveEnumValue)) {
      const acc = ctx.addHoist(new Set(values), `enum:${JSON.stringify(values)}`)
      code.push(`if(!${acc}.has(${v})){${ctx.fail(lit(`must be one of: ${label}`), pathExpr)}}`)
    } else {
      ctx.needsDeepEqual = true
      const acc = ctx.addHoist(values, `enumArr:${JSON.stringify(values)}`)
      const idx = ctx.nextVar('e')
      const found = ctx.nextVar('f')
      code.push(
        `var ${found}=false;for(var ${idx}=0;${idx}<${acc}.length;${idx}++){if(deepEqual(${v},${acc}[${idx}])){${found}=true;break;}}if(!${found}){${ctx.fail(lit(`must be one of: ${label}`), pathExpr)}}`,
      )
    }
  }

  // type
  const types = Array.isArray(s['type'])
    ? (s['type'] as string[])
    : typeof s['type'] === 'string'
      ? [s['type']]
      : undefined
  if (types && types.length > 0) {
    const wrong = `!(${types.map((t) => rightTypeExpr(t, v)).join('||')})`
    const label = types.length === 1 ? `must be ${types[0]}` : `must be one of type: ${types.join(', ')}`
    code.push(`if(${wrong}){${ctx.fail(lit(label), pathExpr)}}`)
  }

  // Type-specific keyword blocks. Each self-guards on the value's type, so they
  // compose correctly with unions and with schemas that omit `type` entirely.
  const objectCode = generateObjectKeywords(ctx, s, v, pathExpr)
  if (objectCode) code.push(objectCode)

  const arrayCode = generateArrayKeywords(ctx, s, v, pathExpr)
  if (arrayCode) code.push(arrayCode)

  const stringCode = generateStringKeywords(ctx, s, v, pathExpr)
  if (stringCode) code.push(stringCode)

  const numberCode = generateNumberKeywords(ctx, s, v, pathExpr)
  if (numberCode) code.push(numberCode)

  // allOf — every branch applies in the current (error or boolean) mode.
  if (Array.isArray(s['allOf'])) {
    for (const sub of s['allOf']) {
      code.push(generateSchemaCode(ctx, sub, v, pathExpr))
    }
  }

  // anyOf — at least one branch must pass; branches are evaluated as booleans
  // so their internal failures never reach the caller's error list.
  if (Array.isArray(s['anyOf']) && s['anyOf'].length > 0) {
    const ok = ctx.nextVar('ok')
    let block = `var ${ok}=false;`
    s['anyOf'].forEach((sub, index) => {
      const okb = ctx.nextVar('okb')
      const branch = generateBooleanBranch(ctx, sub, v, okb)
      const attempt = `var ${okb}=true;${branch}if(${okb}){${ok}=true;}`
      block += index === 0 ? attempt : `if(!${ok}){${attempt}}`
    })
    block += `if(!${ok}){${ctx.fail(lit('must match a schema in anyOf'), pathExpr)}}`
    code.push(block)
  }

  // oneOf — exactly one branch must pass.
  if (Array.isArray(s['oneOf']) && s['oneOf'].length > 0) {
    const cnt = ctx.nextVar('cnt')
    let block = `var ${cnt}=0;`
    for (const sub of s['oneOf']) {
      const okb = ctx.nextVar('okb')
      const branch = generateBooleanBranch(ctx, sub, v, okb)
      block += `var ${okb}=true;${branch}if(${okb}){${cnt}++;}`
    }
    block += `if(${cnt}!==1){${ctx.fail(lit('must match exactly one schema in oneOf'), pathExpr)}}`
    code.push(block)
  }

  // not — the subschema must NOT match.
  if ('not' in s) {
    const ok = ctx.nextVar('ok')
    const branch = generateBooleanBranch(ctx, s['not'], v, ok)
    code.push(`var ${ok}=true;${branch}if(${ok}){${ctx.fail(lit('must not match schema'), pathExpr)}}`)
  }

  // if / then / else — the condition is a boolean test; the chosen consequent
  // runs in the current mode so it can report real errors.
  if ('if' in s) {
    const ok = ctx.nextVar('ok')
    const condition = generateBooleanBranch(ctx, s['if'], v, ok)
    let block = `var ${ok}=true;${condition}`
    if ('then' in s) {
      const thenCode = generateSchemaCode(ctx, s['then'], v, pathExpr)
      if (thenCode.trim() !== '') block += `if(${ok}){${thenCode}}`
    }
    if ('else' in s) {
      const elseCode = generateSchemaCode(ctx, s['else'], v, pathExpr)
      if (elseCode.trim() !== '') block += `if(!${ok}){${elseCode}}`
    }
    code.push(block)
  }

  const body = code.join('')
  if (nullable && body !== '') return `if(${v}!==null){${body}}`
  return body
}
