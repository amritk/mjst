import type { IFunctionResult, RulesetFunction } from '../../../core/types'
import { isObject, parseUrlVariables } from './helpers'

/**
 * The address a channel's `parameters` are meant to describe, or `undefined`
 * when this channel has none to compare against.
 *
 * The two majors put the address in different places, and only one of them puts
 * it in the map key:
 *
 * - **3.x** keys `channels` by *name* and carries the address in an `address`
 *   field, which is optional — `null` means the address is unknown or dynamic.
 * - **2.x** has no `address` field: the key of `$.channels` *is* the address.
 *   The key of `$.components.channels` is still only a name, though, so reading
 *   it as an address would report every parameter of a reusable channel as
 *   unused.
 */
const channelAddress = (
  channel: Record<string, unknown>,
  path: readonly (string | number)[],
  document: unknown,
): string | undefined => {
  const declaredAddress = channel['address']
  if (typeof declaredAddress === 'string') return declaredAddress
  // Only 2.x keys a channel by its address, so the version decides whether the
  // map key means anything here. A 3.x channel with a non-string `address` has
  // declared its address unknown, and there is nothing to compare against.
  const version = isObject(document) ? document['asyncapi'] : undefined
  if (typeof version !== 'string' || !version.startsWith('2.')) return undefined
  if (path.length !== 2 || path[0] !== 'channels') return undefined
  return typeof path[1] === 'string' ? path[1] : undefined
}

/**
 * Every `{parameter}` in a channel's address must be described in its
 * `parameters` object, and nothing may be described that the address does not
 * use.
 */
export const asyncApiChannelParameters: RulesetFunction = (channel, _options, context): IFunctionResult[] => {
  if (!isObject(channel)) return []
  const parameters = channel['parameters']
  if (!isObject(parameters)) return []

  const address = channelAddress(channel, context.path, context.document.data)
  if (address === undefined) return []
  const declared = new Set(parseUrlVariables(address))

  const results: IFunctionResult[] = []
  // `Object.hasOwn`, not `in`: parameter names come from the document, so a
  // `{constructor}` in the address would otherwise be answered by
  // `Object.prototype` and its missing description go unreported.
  const missing = [...declared].filter((name) => !Object.hasOwn(parameters, name))
  if (missing.length > 0) {
    results.push({
      message: `Channel parameters must be described: ${missing.join(', ')}`,
      path: [...context.path, 'parameters'],
    })
  }
  for (const name of Object.keys(parameters)) {
    if (!declared.has(name)) {
      results.push({
        message: `Channel parameter "${name}" is not used in the channel address`,
        path: [...context.path, 'parameters', name],
      })
    }
  }
  return results
}
