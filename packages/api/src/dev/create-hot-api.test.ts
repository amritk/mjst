import { describe, expect, it, vi } from 'vitest'

import { createApi } from '../create-api'
import { defineRoute } from '../define-route'
import type { AnyRouteContract, ApiRequest } from '../types'
import { createHotApi } from './create-hot-api'
import type { Watcher } from './watch-paths'

const request = (method: string, path: string): ApiRequest => ({
  method,
  path,
  searchParams: () => new URLSearchParams(''),
  header: () => undefined,
  readBody: () => Promise.reject(new SyntaxError('Unexpected end of input')),
  readText: () => Promise.resolve(''),
  readBytes: () => Promise.resolve(new Uint8Array()),
})

/** A route whose reply carries `name`, so a swap is visible in the response body. */
const greeting = (name: string) =>
  defineRoute({
    method: 'get',
    path: '/greeting',
    responses: { 200: { body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
    handler: () => ({ status: 200, body: { name } }),
  })

const health = defineRoute({
  method: 'get',
  path: '/health',
  responses: { 200: {} },
  handler: () => ({ status: 200 }),
})

/** A watcher seam a test drives by hand, standing in for the filesystem. */
const manualWatcher = (): { watch: Watcher; change: (files?: readonly string[]) => void; closed: () => boolean } => {
  let listener: ((changed: readonly string[]) => void) | undefined
  let disposed = false
  return {
    watch: (onChange) => {
      listener = onChange
      return () => {
        disposed = true
      }
    },
    change: (files = ['/app/src/routes.ts']) => listener?.(files),
    closed: () => disposed,
  }
}

describe('create-hot-api', () => {
  it('serves the routes from the first build', async () => {
    const api = await createHotApi({ load: () => ({ routes: [greeting('Ada')] }), log: false })

    expect(await api.handle(request('GET', '/greeting'))).toMatchObject({ status: 200, body: { name: 'Ada' } })
    expect(api.generation()).toBe(1)
    expect(api.error()).toBeUndefined()
    expect(api.routes).toHaveLength(1)
  })

  it('swaps the routes a reload builds', async () => {
    let name = 'Ada'
    const api = await createHotApi({ load: () => ({ routes: [greeting(name)] }), log: false })

    name = 'Grace'
    expect(await api.reload()).toBe(true)

    expect(await api.handle(request('GET', '/greeting'))).toMatchObject({ status: 200, body: { name: 'Grace' } })
    expect(api.generation()).toBe(2)
  })

  it('keeps serving the previous build when a reload fails', async () => {
    let fail = false
    const api = await createHotApi({
      load: () => {
        if (fail) throw new Error('syntax error in routes.ts')
        return { routes: [greeting('Ada')] }
      },
      log: false,
    })

    fail = true
    expect(await api.reload()).toBe(false)

    // The last good build still answers, which is the whole point — a typo
    // must not take the dev server down.
    expect(await api.handle(request('GET', '/greeting'))).toMatchObject({ status: 200, body: { name: 'Ada' } })
    expect((api.error() as Error).message).toBe('syntax error in routes.ts')
    expect(api.generation()).toBe(1)
  })

  it('serves 503 until the first build succeeds, then recovers', async () => {
    let fail = true
    const api = await createHotApi({
      load: () => {
        if (fail) throw new Error('cannot find module ./routes.ts')
        return { routes: [greeting('Ada')] }
      },
      log: false,
    })

    const response = await api.handle(request('GET', '/greeting'))
    expect(response.status).toBe(503)
    expect(response.body).toMatchObject({ error: 'not_loaded' })
    expect((response.body as { message: string }).message).toContain('cannot find module ./routes.ts')
    expect(api.generation()).toBe(0)
    // Unmatched-looking requests still belong to the API while it is broken,
    // so a middleware-style adapter reports the 503 instead of a 404.
    expect(api.matches('GET', '/anything')).toBe(true)
    expect(() => api.openApi()).toThrow(/failed to load/)

    fail = false
    expect(await api.reload()).toBe(true)
    expect(await api.handle(request('GET', '/greeting'))).toMatchObject({ status: 200, body: { name: 'Ada' } })
    expect(api.error()).toBeUndefined()
  })

  it('reloads when the watcher reports a change, and reports the files', async () => {
    let name = 'Ada'
    const watcher = manualWatcher()
    const reloads: Array<readonly string[]> = []
    const api = await createHotApi({
      load: () => ({ routes: [greeting(name)] }),
      watch: watcher.watch,
      onReload: (event) => reloads.push(event.changed),
      log: false,
    })

    name = 'Grace'
    watcher.change(['/app/src/routes.ts'])
    await vi.waitFor(() => expect(api.generation()).toBe(2))

    expect(await api.handle(request('GET', '/greeting'))).toMatchObject({ status: 200, body: { name: 'Grace' } })
    // The first build has no files behind it; the reload carries the edit.
    expect(reloads).toEqual([[], ['/app/src/routes.ts']])
  })

  it('collapses reloads that arrive while a build is running', async () => {
    let builds = 0
    let release: () => void = () => {}
    const api = await createHotApi({
      load: async () => {
        builds += 1
        if (builds === 2) await new Promise<void>((resolve) => (release = resolve))
        return { routes: [greeting('Ada')] }
      },
      log: false,
    })

    // Three edits land while build #2 is still running: they share one
    // follow-up pass rather than queueing a build each.
    const first = api.reload(['a.ts'])
    const second = api.reload(['b.ts'])
    const third = api.reload(['c.ts'])
    release()

    expect(await Promise.all([first, second, third])).toEqual([true, true, true])
    expect(builds).toBe(3)
    expect(api.generation()).toBe(3)
  })

  it('passes the files from a coalesced burst to the build that sees them', async () => {
    const changed: Array<readonly string[]> = []
    let release: () => void = () => {}
    let builds = 0
    const api = await createHotApi({
      load: async () => {
        builds += 1
        if (builds === 2) await new Promise<void>((resolve) => (release = resolve))
        return { routes: [greeting('Ada')] }
      },
      onReload: (event) => changed.push(event.changed),
      log: false,
    })

    const first = api.reload(['a.ts'])
    const queued = Promise.all([api.reload(['b.ts']), api.reload(['c.ts'])])
    release()
    await first
    await queued

    expect(changed).toEqual([[], ['a.ts'], ['b.ts', 'c.ts']])
  })

  it('accepts an Api that load built itself', async () => {
    const api = await createHotApi({
      load: () => createApi({ routes: [health], info: { title: 'Hot', version: '2.0.0' } }),
      log: false,
    })

    expect(await api.handle(request('GET', '/health'))).toMatchObject({ status: 200 })
    expect(api.openApi().info).toEqual({ title: 'Hot', version: '2.0.0' })
  })

  it('rebuilds the OpenAPI document and the match table on every swap', async () => {
    let routes: AnyRouteContract[] = [health]
    const api = await createHotApi({ load: () => ({ routes }), log: false })

    expect(api.matches('GET', '/greeting')).toBe(false)
    expect(Object.keys(api.openApi().paths ?? {})).toEqual(['/health'])

    routes = [health, greeting('Ada')]
    await api.reload()

    expect(api.matches('GET', '/greeting')).toBe(true)
    expect(Object.keys(api.openApi().paths ?? {})).toEqual(['/health', '/greeting'])
  })

  it('reports a failed reload through onReloadError instead of throwing', async () => {
    const errors: unknown[] = []
    const api = await createHotApi({
      load: () => {
        throw new Error('boom')
      },
      onReloadError: (error, files) => errors.push([error, files]),
      log: false,
    })

    await api.reload(['routes.ts'])
    expect(errors).toHaveLength(2)
    expect(errors[1]).toEqual([expect.any(Error), ['routes.ts']])
  })

  it('stops watching on close, and closing twice is harmless', async () => {
    const watcher = manualWatcher()
    const api = await createHotApi({ load: () => ({ routes: [health] }), watch: watcher.watch, log: false })

    api.close()
    api.close()
    expect(watcher.closed()).toBe(true)

    // The API keeps serving its last build after the watcher is gone.
    expect(await api.handle(request('GET', '/health'))).toMatchObject({ status: 200 })
  })
})
