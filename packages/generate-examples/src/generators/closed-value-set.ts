import { hasConst, hasEnum, hasType, isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { satisfiesScalarConstraints } from './satisfies-scalar-constraints'

/**
 * The complete set of values an item schema admits, when that set is finite and
 * small enough to enumerate: `const`, `enum`, `boolean`, `null`. `uniqueItems`
 * needs distinct elements, and for these schemas perturbing one value would step
 * straight out of the schema, so the deriver walks this set instead of nudging.
 * `undefined` means the value space is open and perturbing is fine.
 *
 * The arbitrary generator asks the same question for a different reason: a set
 * of N values cannot fill a `uniqueArray` of more than N slots, and fast-check
 * retries forever rather than admitting it — so `{ items: { type: 'boolean' },
 * minItems: 5, uniqueItems: true }` produced an arbitrary that hung when sampled.
 */
export const closedValueSet = (schema: JSONSchema | undefined): unknown[] | undefined => {
  if (schema === undefined || !isSchemaObject(schema)) return undefined
  if (hasConst(schema)) return [schema.const]
  if (hasEnum(schema)) {
    const fitting = schema.enum.filter((value) => satisfiesScalarConstraints(schema, value))
    return fitting.length > 0 ? fitting : [...schema.enum]
  }
  if (hasType(schema) && schema.type === 'boolean') return [true, false]
  if (hasType(schema) && schema.type === 'null') return [null]
  return undefined
}
