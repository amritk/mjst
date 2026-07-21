/**
 * One readiness probe: a name and a function that resolves truthy when the
 * dependency (database, cache, upstream) is reachable. Returning `false` or
 * throwing marks it down. Keep them fast and side-effect-free — a probe runs
 * on every health request.
 */
export type HealthCheck = {
  readonly name: string
  readonly check: () => boolean | Promise<boolean>
}

/**
 * Options for {@link createHealth}.
 */
export type HealthOptions = {
  /**
   * Readiness probes. Omit for a bare liveness endpoint (always `200` while
   * the process serves requests). All probes run concurrently.
   */
  readonly checks?: readonly HealthCheck[]
  /** Extra fields merged into the JSON body (version, commit, region). */
  readonly info?: Readonly<Record<string, unknown>>
}

type ProbeResult = { readonly name: string; readonly status: 'up' | 'down' }

/**
 * A health/readiness endpoint — the `@nestjs/terminus` / Spring Actuator
 * surface orchestrators poll, which this framework left to the app. Returns a
 * `(Request) => Response` for the `mounts` option: it runs every probe
 * concurrently and answers `200 {status:'ok'}` when all pass, or
 * `503 {status:'error'}` listing which are down — the status code load
 * balancers and Kubernetes readiness gates key on. A probe that throws counts
 * as down rather than crashing the endpoint.
 *
 * @example
 * ```typescript
 * const handler = toFetchHandler(api, {
 *   mounts: {
 *     '/healthz': createHealth(),
 *     '/readyz': createHealth({ checks: [{ name: 'db', check: () => db.ping() }] }),
 *   },
 * })
 * ```
 */
export const createHealth = (options?: HealthOptions): ((request: Request) => Promise<Response>) => {
  const checks = options?.checks ?? []
  const info = options?.info

  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
    }

    const results: ProbeResult[] = await Promise.all(
      checks.map(async ({ name, check }) => {
        try {
          return { name, status: (await check()) ? 'up' : 'down' } as const
        } catch {
          return { name, status: 'down' } as const
        }
      }),
    )

    const healthy = results.every((result) => result.status === 'up')
    const status = healthy ? 200 : 503
    const body =
      results.length === 0
        ? { status: healthy ? 'ok' : 'error', ...info }
        : {
            status: healthy ? 'ok' : 'error',
            checks: Object.fromEntries(results.map((result) => [result.name, result.status])),
            ...info,
          }

    return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}
