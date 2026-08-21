import { fnv1aHex } from './fnv1a-hex'
import type { AnyContract, AnyRouteContract } from './types'

/**
 * What {@link hashContracts} reads. The schema half comes from
 * {@link AnyContract}; the guard slots only exist on {@link AnyRouteContract},
 * and are optional here so a plain contract (no handler, no guards) hashes too.
 */
export type HashableContract = AnyContract & Pick<AnyRouteContract, 'guards' | 'securityGuards'>

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
 * from a stale build get surfaced. Handler, `refine`, and `guard` *bodies* are
 * deliberately excluded — the emitted module imports and calls them live, so
 * rewriting one never makes a build stale.
 *
 * Their **presence** is another matter, and is fingerprinted. The emitter
 * decides at build time whether a route has guards, security guards, or a
 * refine at all, and emits (or omits) the code that runs them. Adding a guard
 * to a route without regenerating therefore used to produce a compiled server
 * that ran the handler with no guard and no warning — the hash could not
 * change, because it never looked. Counting the guards and noting whether
 * `refine` exists keeps the "swapping a guard body is not staleness" promise
 * while catching every add and remove.
 *
 * The hash is computed over a canonical serialization (object keys sorted at
 * every level), so it is insensitive to property declaration order but
 * sensitive to any value change. Route order matters — callers on both sides
 * of the comparison must pass the same order, which the emitter guarantees by
 * baking the array in its own emit order.
 */
export const hashContracts = (routes: ReadonlyArray<HashableContract>): string =>
  fnv1aHex(sortedStringify(routes.map(contractFields)))

/**
 * Picks exactly the contract-relevant fields. An explicit pick (rather than
 * hashing the whole contract) keeps the function *bodies* — `handler`,
 * `refine`, `guards` — out of the fingerprint by construction, while the
 * presence-only counts below still record that they exist.
 */
const contractFields = (contract: HashableContract): Record<string, unknown> => {
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
    // `messages` is deliberately absent. The fingerprint answers one question —
    // "does this compiled module still match the contracts it was built from?"
    // — and `compileToModule` never emits message schemas: they are read live
    // by `bindMessages`/`connectMessages`, like `handler` and `guards`.
    // Including them reported a stale module for an edit that cannot stale one.
    guards: contract.guards?.length ?? 0,
    securityGuards: contract.securityGuards?.length ?? 0,
    refine: contract.refine !== undefined,
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
