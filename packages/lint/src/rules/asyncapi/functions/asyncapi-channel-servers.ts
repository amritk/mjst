import type { IFunctionResult, RulesetFunction } from '../../../core/types'
import { isObject } from './helpers'

/**
 * Checks that each name in a 2.x channel's `servers` list names a server the
 * document actually declares. Given the whole document (`$`), because the check
 * needs the top-level `servers` map as well as the channel.
 */
export const asyncApiChannelServers: RulesetFunction = (document, _options, _context): IFunctionResult[] => {
  if (!isObject(document)) return []
  const channels = document['channels']
  if (!isObject(channels)) return []
  const declared = isObject(document['servers']) ? Object.keys(document['servers']) : []

  const results: IFunctionResult[] = []
  for (const [address, channel] of Object.entries(channels)) {
    if (!isObject(channel)) continue
    const servers = channel['servers']
    if (!Array.isArray(servers)) continue
    servers.forEach((name, index) => {
      if (typeof name === 'string' && !declared.includes(name)) {
        results.push({
          message: `Channel server "${name}" is not defined in the "servers" object`,
          path: ['channels', address, 'servers', index],
        })
      }
    })
  }
  return results
}
