import type { Coercion } from './types'

/**
 * Derives the string-to-type conversion plan for a params/query schema at
 * startup. HTTP delivers every parameter as a string, so declared `number` /
 * `integer` / `boolean` / `array` properties need converting before validation
 * — and doing the schema inspection once here keeps it out of the per-request
 * path entirely.
 *
 * Only single-`type` properties get a plan entry; anything more exotic
 * (union types, `anyOf`, missing `type`) is left as a string and judged by the
 * validator as authored.
 */
export const buildCoercionPlan = (schema: unknown): ReadonlyMap<string, Coercion> => {
  const plan = new Map<string, Coercion>()
  if (typeof schema !== 'object' || schema === null) return plan
  const properties = (schema as { properties?: unknown }).properties
  if (typeof properties !== 'object' || properties === null) return plan
  for (const [key, property] of Object.entries(properties)) {
    const coercion = coercionFor(property)
    if (coercion !== undefined) plan.set(key, coercion)
  }
  return plan
}

const coercionFor = (property: unknown): Coercion | undefined => {
  if (typeof property !== 'object' || property === null) return undefined
  const type = (property as { type?: unknown }).type
  if (type === 'number' || type === 'integer') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'array') {
    const items = (property as { items?: unknown }).items
    const itemType = typeof items === 'object' && items !== null ? (items as { type?: unknown }).type : undefined
    if (itemType === 'number' || itemType === 'integer') return 'number-array'
    if (itemType === 'boolean') return 'boolean-array'
    return 'string-array'
  }
  return undefined
}
