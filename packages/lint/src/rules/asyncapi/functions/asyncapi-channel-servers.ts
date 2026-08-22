import type { IFunctionResult, JsonPath, RulesetFunction } from '../../../core/types'
import { isObject } from './helpers'
import { pointerSegment } from './pointer'

const SERVERS_REF = '#/servers/'

/** What one `servers` entry turned out to be. */
type ServerEntry =
  /** Names a server that must exist in the top-level `servers` map. */
  | { kind: 'named'; name: string; path: JsonPath }
  /** A reference, but not into `#/servers`. */
  | { kind: 'elsewhere'; ref: string; path: JsonPath }
  /** Not a server reference at all; the structural rules report the shape. */
  | undefined

/**
 * Reads one channel `servers` entry.
 *
 * 2.x lists server *names* as plain strings; 3.0 replaced that with Reference
 * Objects. Both ultimately name a server, which is the thing worth checking.
 */
const readEntry = (entry: unknown): ServerEntry => {
  if (typeof entry === 'string') return { kind: 'named', name: entry, path: [] }
  if (!isObject(entry)) return undefined
  const ref = entry['$ref']
  if (typeof ref !== 'string') return undefined
  if (!ref.startsWith(SERVERS_REF)) return { kind: 'elsewhere', ref, path: ['$ref'] }
  return { kind: 'named', name: pointerSegment(ref.slice(SERVERS_REF.length)), path: ['$ref'] }
}

/**
 * Checks that every server a channel lists is one the document declares.
 *
 * The spec scopes this to where the channel is written, and the two cases differ
 * (AsyncAPI 3.0, Channel Object `servers`): a channel in the **root** Channels
 * Object "MUST point to a subset of server definitions located in the root
 * Servers Object, and MUST NOT point to … the Components Object or anywhere
 * else", while a channel in the Components Object "MAY point to a Server Object
 * in any location".
 *
 * The carve-out excuses only references pointing *outside* `#/servers`, so it
 * suspends one of the two checks and not the other. A reusable 3.0 channel
 * pointing at `#/components/servers/staging` is permitted and must stay silent;
 * one pointing at `#/servers/nope` still names the root Servers Object and must
 * still exist there. Skipping reusable channels altogether lost that second
 * check, and reporting them lost the first.
 *
 * 2.x has no carve-out at all — a channel's `servers` is a list of names from
 * the root Servers Object wherever the channel is written — so both checks apply
 * to both locations there.
 *
 * Given the whole document (`$`), because the check needs the top-level
 * `servers` map as well as each channel. Runs unresolved, so a 3.0 `$ref` is
 * still a reference rather than the server it points at.
 */
export const asyncApiChannelServers: RulesetFunction = (document, _options, _context): IFunctionResult[] => {
  if (!isObject(document)) return []
  // A `Set`: both lists are document-sized, and a linear scan per entry made
  // this quadratic on a document declaring many servers.
  const declared = new Set(isObject(document['servers']) ? Object.keys(document['servers']) : [])
  const version = document['asyncapi']
  const isV2 = typeof version === 'string' && version.startsWith('2.')
  const components = isObject(document['components']) ? document['components'] : undefined
  const roots: { path: JsonPath; channels: unknown; mustPointAtRootServers: boolean }[] = [
    { path: ['channels'], channels: document['channels'], mustPointAtRootServers: true },
    // Reusable channels: in 3.0 they may reference a server anywhere, so only the
    // "does it exist" half applies to the ones that do name `#/servers`.
    { path: ['components', 'channels'], channels: components?.['channels'], mustPointAtRootServers: isV2 },
  ]

  const results: IFunctionResult[] = []
  for (const root of roots) {
    if (!isObject(root.channels)) continue
    for (const [address, channel] of Object.entries(root.channels)) {
      if (!isObject(channel)) continue
      const servers = channel['servers']
      if (!Array.isArray(servers)) continue
      servers.forEach((entry, index) => {
        const read = readEntry(entry)
        if (read === undefined) return
        const at = (): JsonPath => [...root.path, address, 'servers', index, ...read.path]
        if (read.kind === 'elsewhere') {
          if (!root.mustPointAtRootServers) return
          results.push({
            message: `A root channel's server must reference "${SERVERS_REF}…", not "${read.ref}"`,
            path: at(),
          })
        } else if (!declared.has(read.name)) {
          results.push({ message: `Channel server "${read.name}" is not defined in the "servers" object`, path: at() })
        }
      })
    }
  }
  return results
}
