import type { PathParamsBuilder } from './create-client'

/**
 * Fills a contract's path template. Plain parameters are fully encoded; a
 * greedy `{name+}` value is encoded per segment so its slashes survive as
 * path structure — the inverse of the server's per-segment decode.
 *
 * Opt-in on purpose: `createClient` only needs this when a contract path
 * declares `{param}` segments, so apps with static paths skip these bytes
 * entirely. Register it via `createClient(contracts, url, { pathParams:
 * buildParamPath })`.
 */
export const buildParamPath: PathParamsBuilder = (pattern, params) =>
  pattern.replace(/\{([^}]+)\}/g, (_match, rawName: string) => {
    const greedy = rawName.endsWith('+')
    const key = greedy ? rawName.slice(0, -1) : rawName
    const value = params?.[key]
    if (value === undefined) throw new Error(`Missing path parameter '${key}' for '${pattern}'`)
    const text = String(value)
    return greedy ? text.split('/').map(encodeURIComponent).join('/') : encodeURIComponent(text)
  })
