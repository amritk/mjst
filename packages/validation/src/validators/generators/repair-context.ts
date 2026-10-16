import { readKey } from '@amritk/helpers/read-key'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import type { createSubschemaMatcher } from './generate-validator-function'

/**
 * What the repairing half of one file is built from: its declarations, its
 * numbering, and the tests the lookup and the walk share. One context per file,
 * so the lookup and the walk emitted into it can never name two things alike.
 */
export type RepairContext = {
  readonly typeSuffix: string
  /** Declarations, in the order they must appear. */
  readonly helpers: string[]
  /** Supplies the next unique suffix for a declaration. */
  next: () => number
  /** The validator's own yes/no tests, for `propertyNames`, an `if`, and the walk. */
  readonly matcher: ReturnType<typeof createSubschemaMatcher>
  /**
   * The lookup already emitted for a subschema, by identity. The walk asks for
   * the lookup of every node it checks, and a node must answer with the one
   * function rather than a second copy of it.
   */
  readonly lookups: Map<unknown, string | null>
  /** The yes/no test already emitted for a subschema, by identity. */
  readonly tests: Map<unknown, boolean | string>
  /** The shared lookup a `false` schema answers with, once something needs it. */
  drop: string | null
}

/**
 * A named yes/no test of a value against `sub`, `true` when every value passes,
 * or `false` when none does.
 *
 * It is the validator's own test, so the lookup, the walk and `validateX` agree
 * on which branch a document takes. A body only the buffered form can express
 * gets a function of its own here, as the coercer does it.
 */
export const namedTest = (sub: JSONSchema, ctx: RepairContext): boolean | string => {
  const known = ctx.tests.get(sub)
  if (known !== undefined) return known
  const named = ctx.matcher.named(sub)
  if (named !== null) {
    ctx.tests.set(sub, named)
    return named
  }
  const body = ctx.matcher.test(sub)
  if (typeof body !== 'string') {
    ctx.tests.set(sub, body)
    return body
  }
  const name = `_repairTest${ctx.next()}`
  const parameter = /\binput\b/.test(body) ? 'input' : '_input'
  const path = /\b_path\b/.test(body) ? [`  const _path = ''`] : []
  ctx.helpers.push([`const ${name} = (${parameter}: unknown): boolean => {`, ...path, body, `}`].join('\n'))
  ctx.tests.set(sub, name)
  return name
}

/** A schema map keyword (`properties`, …), read as own properties only. */
export const schemaMap = (schema: Record<string, unknown>, key: string): Record<string, JSONSchema> | undefined => {
  const value = readKey(schema, key)
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, JSONSchema>)
    : undefined
}

/** A subschema keyword (`then`, `items`, …), when it holds a schema at all. */
export const subschema = (schema: Record<string, unknown>, key: string): JSONSchema | undefined => {
  const value = readKey(schema, key)
  return typeof value === 'boolean' || (typeof value === 'object' && value !== null && !Array.isArray(value))
    ? (value as JSONSchema)
    : undefined
}
