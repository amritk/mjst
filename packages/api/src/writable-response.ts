/**
 * Returns a `Response` whose headers can be mutated — the same one when it is
 * already writable, a constructor clone when it is not.
 *
 * Responses the adapters build have mutable headers, so an `onResponse` hook
 * can stamp them directly. A `Response` that came out of `fetch()` cannot: it
 * carries an immutable header guard, and `headers.set(...)` on it throws a
 * `TypeError`. That is not an exotic case — any proxying mount (`mounts: {
 * '/api/auth': (request) => auth.handler(request) }`) returns exactly such a
 * response, and every decorator downstream of it then runs against one. Since
 * a throwing hook collapses the request to a 500, a decorator that skips this
 * probe turns "we proxied a request" into "we lost the response".
 *
 * There is no public flag for the header guard, so the only way to know is to
 * try a mutation and see whether it throws.
 *
 * @example
 * ```typescript
 * const stampVersion: FetchOnResponse = (response) => {
 *   const target = writableResponse(response)
 *   target.headers.set('x-api-version', '3')
 *   return target
 * }
 * ```
 */
export const writableResponse = (response: Response): Response => {
  try {
    // Probing with a real mutation, then undoing it: a header the caller never
    // asked for must not survive the probe.
    response.headers.append('x-amritk-probe', '1')
    response.headers.delete('x-amritk-probe')
    return response
  } catch {
    return new Response(response.body, response)
  }
}
