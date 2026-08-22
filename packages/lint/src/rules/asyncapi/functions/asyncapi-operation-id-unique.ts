import type { IFunctionResult, JsonPath, RulesetFunction } from '../../../core/types'
import { getAllOperations, isObject } from './helpers'

/** The `operationId` an operation ends up with, and where it was written. See `asyncapi-message-id-unique`. */
const effectiveOperationId = (operation: Record<string, unknown>): { id: string; path: JsonPath } | undefined => {
  const traits = operation['traits']
  if (Array.isArray(traits)) {
    for (let index = traits.length - 1; index >= 0; index--) {
      const trait = traits[index]
      if (isObject(trait) && typeof trait['operationId'] === 'string') {
        return { id: trait['operationId'], path: ['traits', index, 'operationId'] }
      }
    }
  }
  return typeof operation['operationId'] === 'string'
    ? { id: operation['operationId'], path: ['operationId'] }
    : undefined
}

/** Ensures `operationId` values are unique across every operation in a 2.x document. */
export const asyncApiOperationIdUnique: RulesetFunction = (document, _options, _context): IFunctionResult[] => {
  const seen = new Set<string>()
  const results: IFunctionResult[] = []
  for (const { path, operation } of getAllOperations(document)) {
    const found = effectiveOperationId(operation)
    if (found === undefined) continue
    if (seen.has(found.id)) {
      results.push({ message: `operationId "${found.id}" must be unique`, path: [...path, ...found.path] })
    }
    seen.add(found.id)
  }
  return results
}
