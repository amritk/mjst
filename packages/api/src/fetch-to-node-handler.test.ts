import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { compileToModule } from './compile/compile-to-module'
import * as corpus from './compile/compile-to-module.test-utils'
import type { FetchLikeHandler } from './fetch-to-node-handler'
import { fetchToNodeHandler } from './fetch-to-node-handler'

// The fixture lives next to the corpus so the emitted module's relative
// imports (routes and runtime) resolve, exactly like the differential test.
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'compile', '.fixtures-node-bridge')

/** The compiled engine's fetch export — what the bridge exists to serve. */
let compiledFetch: FetchLikeHandler

beforeAll(async () => {
  mkdirSync(fixtureDir, { recursive: true })
  const source = compileToModule({
    routesImport: '../compile-to-module.test-utils',
    runtimeImport: '../../index',
    validatorsImport: '@amritk/runtime-validators',
    routes: {
      health: corpus.health,
      createUser: corpus.createUser,
      streamChat: corpus.streamChat,
      login: corpus.login,
      endlessStream: corpus.endlessStream,
    },
    info: { title: 'Bridge', version: '1.0.0' },
  })
  const fixturePath = join(fixtureDir, 'generated-bridge.ts')
  writeFileSync(fixturePath, source)
  const module = (await import(fixturePath)) as { fetch: FetchLikeHandler }
  compiledFetch = module.fetch
})

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true })
})

/**
 * Runs a real node:http server for one test so the bridge is exercised
 * against genuine IncomingMessage/ServerResponse streams.
 */
const withServer = async (server: Server, run: (origin: string) => Promise<void>): Promise<void> => {
  await new Promise<void>((resolve) => server.listen(0, resolve))
  try {
    const { port } = server.address() as AddressInfo
    await run('http://127.0.0.1:' + port)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

describe('fetch-to-node-handler', () => {
  it('serves a compiled module JSON route over node:http, including the 404 path', async () => {
    const server = createServer(fetchToNodeHandler(compiledFetch))
    await withServer(server, async (origin) => {
      const response = await fetch(origin + '/health')
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/json')
      expect(await response.json()).toEqual({ ok: true })

      const missing = await fetch(origin + '/missing')
      expect(missing.status).toBe(404)
      expect(await missing.json()).toEqual({ error: 'not_found' })
    })
  })

  it('streams the request body through to the compiled engine, validation included', async () => {
    const server = createServer(fetchToNodeHandler(compiledFetch))
    await withServer(server, async (origin) => {
      const created = await fetch(origin + '/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ada', age: 30 }),
      })
      expect(created.status).toBe(201)
      expect(await created.json()).toEqual({ name: 'Ada', age: 30 })

      const invalid = await fetch(origin + '/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      })
      expect(invalid.status).toBe(400)
      expect(((await invalid.json()) as { error: string }).error).toBe('validation_failed')
    })
  })

  it('streams a raw contentType response chunk by chunk', async () => {
    const server = createServer(fetchToNodeHandler(compiledFetch))
    await withServer(server, async (origin) => {
      const response = await fetch(origin + '/chat', { method: 'POST' })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect(response.headers.get('x-frame-protocol')).toBe('1')
      expect(await response.text()).toBe('token-1 token-2')
    })
  })

  it('writes repeated set-cookie values as separate header lines', async () => {
    const server = createServer(fetchToNodeHandler(compiledFetch))
    await withServer(server, async (origin) => {
      const response = await fetch(origin + '/login', { method: 'POST' })
      expect(response.status).toBe(200)
      // getSetCookie is the only un-folded view — a joined value would show
      // up here as a single corrupted cookie.
      expect(response.headers.getSetCookie()).toEqual(['session=abc123; Path=/; HttpOnly', 'csrf=xyz789; Path=/'])
      expect(response.headers.get('x-single')).toBe('one')
      expect(await response.json()).toEqual({ ok: true })
    })
  })

  it('cancels the compiled stream instead of pumping forever when the client disconnects', async () => {
    corpus.endlessState.cancelled = false
    const server = createServer(fetchToNodeHandler(compiledFetch))
    await withServer(server, async (origin) => {
      const controller = new AbortController()
      const response = await fetch(origin + '/endless', { signal: controller.signal })
      expect(response.status).toBe(200)
      // Read one chunk so the stream is genuinely flowing, then hang up.
      const reader = (response.body as ReadableStream<Uint8Array>).getReader()
      await reader.read()
      controller.abort()
      // The drain wait must bail on the closed response and cancel the
      // handler's source stream instead of writing into the void.
      await expect.poll(() => corpus.endlessState.cancelled, { timeout: 5_000 }).toBe(true)
    })
  }, 15_000)

  it('answers 500 when the fetch handler rejects before anything was sent', async () => {
    // A generic (non-compiled) handler: the bridge works for any fetch
    // handler, and the compiled engine never rejects on its own.
    const throwing: FetchLikeHandler = () => {
      throw new Error('nope')
    }
    const server = createServer(fetchToNodeHandler(throwing))
    await withServer(server, async (origin) => {
      const response = await fetch(origin + '/anything')
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'internal_error' })
      // The server survived to answer another request.
      expect((await fetch(origin + '/anything')).status).toBe(500)
    })
  })

  it('forwards the configured env to the handler', async () => {
    const seen: unknown[] = []
    const echoEnv: FetchLikeHandler = (_request, env) => {
      seen.push(env)
      return Response.json({ ok: true })
    }
    const server = createServer(fetchToNodeHandler(echoEnv, { env: { tenant: 'acme' } }))
    await withServer(server, async (origin) => {
      expect((await fetch(origin + '/env')).status).toBe(200)
      expect(seen).toEqual([{ tenant: 'acme' }])
    })
  })
})
