import { identifierMentions } from '@amritk/helpers/identifier-mentions'
import { readKey } from '@amritk/helpers/read-key'
import { refToFilename } from '@amritk/helpers/ref-to-filename'
import { refToName } from '@amritk/helpers/ref-to-name'
import { isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { generateCoerceWalk } from '#validators/generators/generate-coerce-function'

/**
 * The exact, coercing half of a coercing parser file: `matchesX`, a yes/no test
 * that agrees with `validateX` on every value, and `coerceXInput`, the walk
 * `coerceX` runs. `wrap` says whether `parseX` itself runs them ahead of its
 * repair, or whether the file only carries them for another file to call.
 */
export type ExactHalf = {
  readonly code: string
  readonly wrap: boolean
}

/** The name of a definition's exact yes/no test. */
export const exactMatcherName = (typeName: string): string => `matches${typeName}`

/** The name of a definition's coercion walk, as the parser exports it. */
export const exactCoercerName = (typeName: string): string => `coerce${typeName}Input`

/** The name the repairing parser takes when `parseX` is the wrapper in front of it. */
export const repairParserName = (typeName: string): string => `_parse${typeName}Repair`

/**
 * The keywords the repairing parser handles inexactly. A definition carrying one
 * anywhere in its own tree gets the exact half in front of its parser; one that
 * carries none is left exactly as it was, since the parser already coerces those
 * shapes to what `coerceX` produces.
 */
const COMBINATOR_KEYS = ['anyOf', 'oneOf', 'allOf', 'if', 'not'] as const

const SINGLE_SUBSCHEMA_KEYS = [
  'additionalProperties',
  'additionalItems',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
  'unevaluatedProperties',
  'unevaluatedItems',
] as const
const SUBSCHEMA_LIST_KEYS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const
const SUBSCHEMA_MAP_KEYS = ['properties', 'patternProperties', 'dependentSchemas', 'dependencies'] as const

/**
 * Every `$ref` a definition's own tree names, and whether that tree carries a
 * combinator. Only schema positions are read — never `$defs`, whose members are
 * definitions of their own, and never a `const`/`enum`/`default` value, which is
 * data that may merely look like a schema.
 */
const scanOwnTree = (schema: JSONSchema): { refs: Set<string>; combinator: boolean } => {
  const refs = new Set<string>()
  let combinator = false
  const visit = (node: unknown): void => {
    if (!isSchemaObject(node as JSONSchema)) return
    const record = node as Record<string, unknown>
    const ref = readKey(record, '$ref')
    if (typeof ref === 'string') refs.add(ref)
    if (COMBINATOR_KEYS.some((key) => readKey(record, key) !== undefined)) combinator = true
    for (const key of SINGLE_SUBSCHEMA_KEYS) visit(readKey(record, key))
    const items = readKey(record, 'items')
    if (Array.isArray(items)) items.forEach(visit)
    else visit(items)
    for (const key of SUBSCHEMA_LIST_KEYS) {
      const list = readKey(record, key)
      if (Array.isArray(list)) list.forEach(visit)
    }
    for (const key of SUBSCHEMA_MAP_KEYS) {
      const map = readKey(record, key)
      if (typeof map === 'object' && map !== null && !Array.isArray(map)) {
        for (const value of Object.values(map)) if (!Array.isArray(value)) visit(value)
      }
    }
  }
  visit(schema)
  return { refs, combinator }
}

/**
 * Emits one definition's exact half, or `null` when the validator's emitters
 * cannot express it (an `unevaluated*` shape they refuse, say) — in which case
 * the definition keeps the repairing parser alone.
 */
const emitExactHalf = (
  schema: JSONSchema,
  typeName: string,
  typeSuffix: string,
  rootSchema: Record<string, unknown>,
  wrap: boolean,
): string | null => {
  let walk: ReturnType<typeof generateCoerceWalk>
  try {
    walk = generateCoerceWalk(schema, {
      typeSuffix,
      rootSchema,
      refCoercer: (ref) => exactCoercerName(refToName(ref, typeSuffix)),
      refGuard: exactMatcherName,
      hoistNamespace: '_exact',
      withRootMatch: true,
    })
  } catch {
    return null
  }
  const { declarations, expression, rootMatch } = walk

  const matcher = exactMatcherName(typeName)
  const matcherSource =
    typeof rootMatch === 'string'
      ? [
          `export const ${matcher} = (${/\binput\b/.test(rootMatch) ? 'input' : '_input'}: unknown): boolean => {`,
          ...(/\b_path\b/.test(rootMatch) ? [`  const _path = ''`] : []),
          rootMatch,
          `}`,
        ].join('\n')
      : `export const ${matcher} = (_input: unknown): boolean => ${rootMatch === true}`
  const text = [...declarations, matcherSource].join('\n')
  // A test that has to collect its errors names the validator's error type,
  // which a parser file does not import. It is declared locally instead — unless
  // the file's own type already goes by that name, which would clash.
  const needsErrorType = /\bValidationError\b/.test(text)
  if (needsErrorType && typeName === 'ValidationError') return null

  const coercer = exactCoercerName(typeName)
  const parts = [
    ...(needsErrorType
      ? ['type ValidationError = { message: string; path: string; keyword: string; params: Record<string, unknown> }']
      : []),
    ...declarations,
    matcherSource,
    `export const ${coercer} = (input: unknown): unknown => ${expression ?? 'input'}`,
  ]
  if (wrap) {
    // A value that already passes has nothing to coerce and nothing to repair,
    // so it comes back as it arrived. One that passes once coerced comes back
    // coerced — exactly what `coerceX` answers for it. Only a value no coercion
    // can make valid reaches the repair, which is the part `coerceX` has no
    // answer for at all.
    const walked =
      expression === null
        ? []
        : [`  const value = ${coercer}(input)`, `  if (${matcher}(value)) return value as ${typeName}`]
    parts.push(
      [
        `export const parse${typeName} = (input: unknown): ${typeName} => {`,
        `  if (${matcher}(input)) return input as ${typeName}`,
        ...walked,
        `  return ${repairParserName(typeName)}(input)`,
        `}`,
      ].join('\n'),
    )
  }
  return parts.join('\n\n')
}

/** One definition as the planner sees it. */
export type ExactHalfNode = {
  readonly typeName: string
  readonly schema: JSONSchema
  readonly rootSchema: Record<string, unknown>
}

/**
 * Decides which definitions of a coercing parser build carry the exact half,
 * and emits it for each.
 *
 * Every definition whose own tree has a combinator is wrapped. Everything such
 * a definition reaches through `$ref` carries the half without the wrapper,
 * because the wrapped definition's test and walk call into it. A definition the
 * emitters cannot express drops out, and so does everything that would have
 * called into it, until what is left is closed — so a file never imports a half
 * that was not written.
 */
export const planExactHalves = (
  nodes: readonly ExactHalfNode[],
  typeSuffix: string,
): ReadonlyMap<string, ExactHalf> => {
  const byName = new Map(nodes.map((node) => [node.typeName, node]))
  const scans = new Map(nodes.map((node) => [node.typeName, scanOwnTree(node.schema)]))
  const targetsOf = (typeName: string): string[] =>
    [...(scans.get(typeName)?.refs ?? [])].map((ref) => refToName(ref, typeSuffix))

  const wrapped = new Set(nodes.filter((node) => scans.get(node.typeName)?.combinator === true).map((n) => n.typeName))
  const closure = new Set<string>()
  const queue = [...wrapped]
  while (queue.length > 0) {
    const name = queue.pop() as string
    if (closure.has(name)) continue
    closure.add(name)
    for (const target of targetsOf(name)) if (!closure.has(target)) queue.push(target)
  }

  const emitted = new Map<string, string>()
  const failed = new Set<string>()
  for (const name of closure) {
    const node = byName.get(name)
    const code =
      node === undefined ? null : emitExactHalf(node.schema, name, typeSuffix, node.rootSchema, wrapped.has(name))
    if (code === null) failed.add(name)
    else emitted.set(name, code)
  }

  let changed = true
  while (changed) {
    changed = false
    for (const name of emitted.keys()) {
      if (targetsOf(name).some((target) => failed.has(target) || !byName.has(target))) {
        emitted.delete(name)
        failed.add(name)
        changed = true
      }
    }
  }

  return new Map([...emitted].map(([name, code]) => [name, { code, wrap: wrapped.has(name) }]))
}

/**
 * The imports a file's exact half needs: each `$ref` target's test and walk that
 * the half actually calls.
 *
 * Its own lines rather than names added to the parser's import collector. That
 * collector walks only the positions the repairing parser reads, and the exact
 * half reads them all — a `$ref` under `not`, inside `propertyNames`, beside
 * another `$ref`. Two import statements from one module are fine; the same name
 * imported twice is not, and the two sets of names never meet.
 */
export const exactHalfImports = (
  schema: JSONSchema,
  code: string,
  options: { readonly selfFilename?: string; readonly typeSuffix: string; readonly importExt: 'js' | 'ts' },
): string[] => {
  const mentions = identifierMentions(code)
  const byFile = new Map<string, string[]>()
  for (const ref of scanOwnTree(schema).refs) {
    const filename = refToFilename(ref)
    if (filename === options.selfFilename || byFile.has(filename)) continue
    const typeName = refToName(ref, options.typeSuffix)
    const names = [exactMatcherName(typeName), exactCoercerName(typeName)].filter((name) => mentions(name))
    if (names.length > 0) byFile.set(filename, names)
  }
  return [...byFile]
    .map(([filename, names]) => `import { ${names.join(', ')} } from './${filename}.${options.importExt}';`)
    .sort()
}
