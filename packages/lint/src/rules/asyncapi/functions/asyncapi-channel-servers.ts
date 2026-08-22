import type { IFunctionResult, JsonPath, RulesetFunction } from '../../../core/types'
import { isObject } from './helpers'

const SERVERS_REF = '#/servers/'

/** What one `servers` entry turned out to be. */
type ServerEntry =
  /** Names a server that must exist in the top-level `servers` map. */
  | { kind: 'named'; name: string; path: JsonPath }
  /** A reference, but not into `#/servers` — which is the only place 3.0 allows. */
  | { kind: 'misdirected'; ref: string; path: JsonPath }
  /** Not a server reference at all; the structural rules report the shape. */
  | undefined

/**
 * Reads one channel `servers` entry.
 *
 * 2.x lists server *names* as plain strings; 3.0 replaced that with Reference
 * Objects, which the spec requires to point into the root `servers` object — a
 * channel may only narrow the servers it is available on, never introduce one.
 * Both spellings ultimately name a key of that map, which is the thing worth
 * checking.
 */
const readEntry = (entry: unknown): ServerEntry => {
  if (typeof entry === 'string') return { kind: 'named', name: entry, path: [] }
  if (!isObject(entry)) return undefined
  const ref = entry['$ref']
  if (typeof ref !== 'string') return undefined
  if (!ref.startsWith(SERVERS_REF)) return { kind: 'misdirected', ref, path: ['$ref'] }
  const name = ref.slice(SERVERS_REF.length).replace(/~1/g, '/').replace(/~0/g, '~')
  return { kind: 'named', name, path: ['$ref'] }
}

/**
 * Checks that every server a channel lists is one the document declares.
 *
 * Given the whole document (`$`), because the check needs the top-level
 * `servers` map as well as each channel. Runs unresolved so a 3.0 `$ref` is
 * still a reference rather than the server it points at.
 */
export const asyncApiChannelServers: RulesetFunction = (document, _options, _context): IFunctionResult[] => {
  if (!isObject(document)) return []
  const channels = document['channels']
  if (!isObject(channels)) return []
  // A `Set`: both lists are document-sized, and a linear scan per entry made
  // this quadratic on a document declaring many servers.
  const declared = new Set(isObject(document['servers']) ? Object.keys(document['servers']) : [])

  const results: IFunctionResult[] = []
  for (const [address, channel] of Object.entries(channels)) {
    if (!isObject(channel)) continue
    const servers = channel['servers']
    if (!Array.isArray(servers)) continue
    servers.forEach((entry, index) => {
      const read = readEntry(entry)
      if (read === undefined) return
      const at = (): JsonPath => ['channels', address, 'servers', index, ...read.path]
      if (read.kind === 'misdirected') {
        results.push({ message: `Channel server must reference "${SERVERS_REF}…", not "${read.ref}"`, path: at() })
      } else if (!declared.has(read.name)) {
        results.push({ message: `Channel server "${read.name}" is not defined in the "servers" object`, path: at() })
      }
    })
  }
  return results
}
