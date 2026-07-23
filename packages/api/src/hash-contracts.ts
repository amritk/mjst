import { fnv1aHex } from './fnv1a-hex'
import type { AnyContract } from './types'

/**
 * A stable fingerprint over everything `compileToModule` bakes into a
 * generated module: routing (method, path), request schemas (params, query,
 * headers, cookies, body, bodyType), the response contracts (body schemas,
 * declared headers, contentType, descriptions), and the OpenAPI-visible
 * annotations (summary, description, tags, operationId, deprecated,
 * security).
 *
 * The compiled module embeds this hash at emit time and recomputes it over
 * the live contracts at init, which is how schema edits that silently drifted
 * from a stale build get surfaced. Handlers, `refine` hooks, and `guards` are
 * deliberately excluded — the emitted module imports and calls them live, so
 * changing them never makes a build stale.
 *
 * The hash is computed over a canonical serialization (object keys sorted at
 * every level), so it is insensitive to property declaration order but
 * sensitive to any value change. Route order matters — callers on both sides
 * of the comparison must pass the same order, which the emitter guarantees by
 * baking the array in its own emit order.
 */
export const hashContracts = (routes: ReadonlyArray<AnyContract>): string =>
  fnv1aHex(sortedStringify(routes.map(contractFields)))

/**
 * Picks exactly the contract-relevant fields. An explicit pick (rather than
 * hashing the whole contract) keeps functions like `handler`, `refine`, and
 * `guards` out of the fingerprint by construction.
 */
const contractFields = (contract: AnyContract): Record<string, unknown> => {
  const request = contract.request
  return {
    method: contract.method,
    path: contract.path,
    summary: contract.summary,
    description: contract.description,
    tags: contract.tags,
    operationId: contract.operationId,
    deprecated: contract.deprecated,
    security: contract.security,
    request:
      request === undefined
        ? undefined
        : {
            params: request.params,
            query: request.query,
            body: request.body,
            bodyType: request.bodyType,
            headers: request.headers,
            cookies: request.cookies,
          },
    responses: contract.responses,
  }
}

/**
 * JSON.stringify with object keys sorted at every level, so two structurally
 * equal values always serialize to the same string. Undefined-valued keys are
 * dropped and undefined array elements become null, matching JSON.stringify.
 */
const sortedStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => sortedStringify(item)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${sortedStringify(item)}`).join(',')}}`
}
