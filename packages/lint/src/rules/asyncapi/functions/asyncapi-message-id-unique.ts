import type { IFunctionResult, JsonPath, RulesetFunction } from '../../../core/types'
import { getAllMessages, isObject } from './helpers'

/**
 * The `messageId` a message ends up with, and where it was written. A trait
 * overrides the message's own field (traits are applied as merge patches), and
 * the last trait to declare one wins — so the reported path is the one a reader
 * has to edit to fix the clash.
 */
const effectiveMessageId = (message: Record<string, unknown>): { id: string; path: JsonPath } | undefined => {
  const traits = message['traits']
  if (Array.isArray(traits)) {
    for (let index = traits.length - 1; index >= 0; index--) {
      const trait = traits[index]
      if (isObject(trait) && typeof trait['messageId'] === 'string') {
        return { id: trait['messageId'], path: ['traits', index, 'messageId'] }
      }
    }
  }
  return typeof message['messageId'] === 'string' ? { id: message['messageId'], path: ['messageId'] } : undefined
}

/** Ensures `messageId` values are unique across every message in a 2.x document. */
export const asyncApiMessageIdUnique: RulesetFunction = (document, _options, _context): IFunctionResult[] => {
  const seen = new Set<string>()
  const results: IFunctionResult[] = []
  for (const { path, message } of getAllMessages(document)) {
    const found = effectiveMessageId(message)
    if (found === undefined) continue
    if (seen.has(found.id)) {
      results.push({ message: `messageId "${found.id}" must be unique`, path: [...path, ...found.path] })
    }
    seen.add(found.id)
  }
  return results
}
