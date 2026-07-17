import { validate, validateGuard } from '@amritk/runtime-validators'

import { compileRoute } from './compile-route'
import type { ApiInternals } from './handle-request'
import { handleRequest } from './handle-request'
import { matchRoute } from './match-route'
import { toOpenApi } from './to-open-api'
import type { Api, ApiOptions, CompiledRoute, OpenApiDocument, ValidatorCompiler } from './types'

/**
 * The default validation engine: the eval-free interpreter from
 * `@amritk/runtime-validators`. Guard and collector share one prepared
 * schema walk (prepare is memoized per schema object), so building both up
 * front costs a single preparation.
 */
const defaultCompile: ValidatorCompiler = (schema) => ({
  guard: validateGuard(schema),
  collect: validate(schema),
})

/**
 * Compiles route contracts into a runnable API. All schema work — path
 * parsing, validator preparation, coercion planning — happens here, once;
 * `handle` then serves requests with no schema inspection, no `new Function`,
 * and no allocation on the miss-free path beyond what the request itself
 * requires. Duplicate `method + path` pairs are a startup error rather than a
 * silent shadow.
 *
 * The generated OpenAPI document is served at `/openapi.json` by default
 * (configurable via `openApiPath`), built lazily on first access and cached.
 */
export const createApi = (options: ApiOptions): Api => {
  const compile = options.compile ?? defaultCompile
  const validateResponses = options.validateResponses ?? false

  const staticRoutes = new Map<string, CompiledRoute>()
  const dynamicRoutes = new Map<string, CompiledRoute[]>()

  for (const contract of options.routes) {
    const route = compileRoute(contract, compile, validateResponses)
    // Rebuilding the path from parsed segments normalizes trailing slashes,
    // so '/users' and '/users/' collide here instead of shadowing at runtime.
    const normalizedPath =
      '/' + route.segments.map((segment) => (typeof segment === 'string' ? segment : '{…}')).join('/')
    const key = route.method + ' ' + normalizedPath
    const isStatic = route.segments.every((segment) => typeof segment === 'string')
    if (isStatic) {
      if (staticRoutes.has(key)) throw new Error(`Duplicate route: ${route.method} ${contract.path}`)
      staticRoutes.set(key, route)
    } else {
      const candidates = dynamicRoutes.get(route.method) ?? []
      if (candidates.some((existing) => samePattern(existing, route))) {
        throw new Error(`Duplicate route: ${route.method} ${contract.path}`)
      }
      candidates.push(route)
      dynamicRoutes.set(route.method, candidates)
    }
  }

  const info = options.info ?? { title: 'API', version: '0.0.0' }
  const openApiPath = options.openApiPath === false ? undefined : (options.openApiPath ?? '/openapi.json')

  let document: OpenApiDocument | undefined
  const openApi = (): OpenApiDocument => {
    document ??= toOpenApi(options.routes, info)
    return document
  }

  const methods = [...new Set(options.routes.map((contract) => contract.method.toUpperCase()))]

  const internals: ApiInternals = {
    table: { staticRoutes, dynamicRoutes, methods },
    openApiPath,
    openApi,
    createContext: options.context,
    onError: options.onError,
    errors: options.errors,
  }

  return {
    handle: (request, env, executionContext) => handleRequest(internals, request, env, executionContext),
    matches: (method, path) => {
      const upper = method.toUpperCase()
      if (openApiPath !== undefined && (upper === 'GET' || upper === 'HEAD') && path === openApiPath) return true
      if (matchRoute(internals.table, upper, path) !== undefined) return true
      // HEAD falls back to GET routes, mirroring the pipeline (RFC 9110).
      return upper === 'HEAD' && matchRoute(internals.table, 'GET', path) !== undefined
    },
    openApi,
    routes: options.routes,
  }
}

/**
 * Two dynamic routes collide when their segment shapes are identical —
 * parameter names do not disambiguate anything at match time, so
 * '/users/{id}' and '/users/{name}' are the same route.
 */
const samePattern = (a: CompiledRoute, b: CompiledRoute): boolean => {
  if (a.segments.length !== b.segments.length) return false
  return a.segments.every((segment, index) => {
    const other = b.segments[index]
    if (typeof segment === 'string') return segment === other
    return typeof other === 'object'
  })
}
