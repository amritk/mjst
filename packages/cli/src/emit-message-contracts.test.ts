import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AnyMessagesContract } from '@amritk/api'
import { bindMessages, connectMessages, DEFAULT_DISCRIMINATOR, prepareMessages } from '@amritk/api'
import type { WebSocketLike } from '@amritk/api/client'
import type { AsyncApiModel } from '@amritk/asyncapi'
import { extractAsyncApi } from '@amritk/asyncapi'
import { parse as parseYaml } from '@amritk/yaml'
import { afterAll, describe, expect, expectTypeOf, it } from 'vitest'

import { createOutputWriter } from './create-output-writer'
import { CONTRACTS_DIR, emitMessageContracts } from './emit-message-contracts'
import { marketDataV1Messages } from './generated-contracts/gemini/contracts/market-data-v1'
import { rootMessages } from './generated-contracts/slack/contracts/root'

/**
 * The two contract trees under `src/generated-contracts/` are this emitter's
 * output, checked in. Their point is that the compiler reads them: a module
 * imported from a path computed at runtime is `any`, so nothing about the types
 * a generated contract *derives* can be asserted through a dynamic import. These
 * are imported the way a consumer would, which is what makes the assertions
 * below real — and makes `types:check` prove that what mjst emits compiles.
 *
 * `regenerates` re-runs the emitter into a temp directory and compares bytes, so
 * the checked-in copies cannot drift from what the emitter would write today.
 */
const GOLDEN_ROOT = new URL('./generated-contracts/', import.meta.url).pathname

/** Temp trees to clean up; they live under `src/` so the test runner can load them. */
const scratchDirs: string[] = []

afterAll(async () => {
  for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true })
})

const modelOf = async (fixture: string): Promise<AsyncApiModel> => {
  // Read the vendored document directly rather than through the shared fixture
  // loader: that module lives outside every package's dependency graph, so it
  // does not type-check from here.
  const path = new URL(`../../../fixtures/asyncapi/${fixture}`, import.meta.url).pathname
  return extractAsyncApi(parseYaml(await readFile(path, 'utf-8')) as Record<string, unknown>)
}

/** A fresh directory under `src/`, removed when the suite ends. */
const scratchDir = async (): Promise<string> => {
  const dir = await mkdtemp(new URL('./.fixtures-contracts-', import.meta.url).pathname)
  scratchDirs.push(dir)
  return dir
}

/** Emits a document's contracts into a fresh directory and returns where they landed. */
const emitInto = async (model: AsyncApiModel, discriminator?: string): Promise<string> => {
  const dir = await scratchDir()
  const writer = await createOutputWriter(dir)
  await emitMessageContracts({
    model,
    writer,
    ...(discriminator !== undefined ? { discriminator } : {}),
  })
  await writer.commit()
  return dir
}

const readContract = (dir: string, file: string): Promise<string> => readFile(join(dir, CONTRACTS_DIR, file), 'utf-8')

/** Reads one message with its contract type intact — `.value` off `next()` widens to `any`. */
const next = async <T>(iterator: AsyncIterableIterator<T>): Promise<T | undefined> => (await iterator.next()).value

/** A push-model socket: the Bun shape, whose frames arrive through `accept`. */
const serverSocket = (): { sent: string[]; send: (data: string) => void; close: () => void } => {
  const sent: string[] = []
  return { sent, send: (data: string) => void sent.push(data), close: () => {} }
}

/** A stand-in socket plus the hook that feeds frames into it from the test. */
type FakeSocket = WebSocketLike & { emit: (type: string, event: unknown) => void }

/** The browser end — a WebSocket stand-in for `connectMessages`' fallback transport. */
const fakeWebSocket = (): { Fake: new () => WebSocketLike; current: () => FakeSocket | undefined } => {
  let live: FakeSocket | undefined

  class Fake implements WebSocketLike {
    binaryType = 'blob'
    private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

    constructor() {
      live = this
      queueMicrotask(() => this.emit('open', {}))
    }

    send = (): void => {}
    close = (): void => this.emit('close', { code: 1000 })
    addEventListener = (type: string, listener: (event: never) => void): void => {
      const existing = this.listeners.get(type) ?? []
      existing.push(listener as (event: unknown) => void)
      this.listeners.set(type, existing)
    }
    emit = (type: string, event: unknown): void => {
      for (const listener of this.listeners.get(type) ?? []) listener(event)
    }
  }

  return { Fake, current: () => live }
}

describe('emit-message-contracts', () => {
  it('renders a channel module that calls defineMessages with the schemas inline', async () => {
    const dir = await emitInto(await modelOf('v2.6/streetlights-mqtt.yaml'))
    const source = await readContract(dir, 'smartylighting-streetlights-1-0-action-streetlight-id-dim.ts')

    expect(source).toContain("import { defineMessages } from '@amritk/api'")
    expect(source).toContain(
      'export const smartylightingStreetlights10ActionStreetlightIdDimMessages = defineMessages({',
    )
    expect(source).toContain(`discriminator: '${DEFAULT_DISCRIMINATOR}'`)
    expect(source).toContain('"dimLight": {')
    expect(source).toContain('} as const,')
    // The peer requirement is stated where whoever opens the file will see it.
    expect(source).toContain('peer dependency')
  })

  it('writes a barrel re-exporting every channel it emitted', async () => {
    const dir = await emitInto(await modelOf('v2.6/streetlights-mqtt.yaml'))
    const barrel = await readContract(dir, 'index.ts')

    expect(barrel).toContain(
      'export { smartylightingStreetlights10EventStreetlightIdLightingMeasuredMessages } from ' +
        "'./smartylighting-streetlights-1-0-event-streetlight-id-lighting-measured.ts'",
    )
    expect(barrel.trim().split('\n')).toHaveLength(4)
  })

  it('always points the barrel at the .ts files it wrote', async () => {
    // `--build` leaves the contracts uncompiled, so a `.js` specifier here would
    // name a file the run never produced.
    const dir = await emitInto(await modelOf('v2.6/streetlights-mqtt.yaml'))
    const barrel = await readContract(dir, 'index.ts')
    expect(barrel).not.toContain(".js'")
    for (const line of barrel.trim().split('\n')) expect(line).toMatch(/\.ts'$/)
  })

  it('omits a direction the channel has no messages for', async () => {
    const dir = await emitInto(await modelOf('v3.0/websocket-gemini.yaml'))
    const source = await readContract(dir, 'market-data-v1.ts')

    expect(source).toContain('serverToClient:')
    // An empty `clientToServer: {}` derives the same `never`, and reads as
    // though somebody meant to come back and fill it in.
    expect(source).not.toContain('clientToServer:')
  })

  it('carries the discriminator override into the emitted module', async () => {
    const dir = await emitInto(await modelOf('v3.0/websocket-gemini.yaml'), 'event')
    expect(await readContract(dir, 'market-data-v1.ts')).toContain("discriminator: 'event'")
  })

  it('writes no module for a channel nothing projected onto, and says why', async () => {
    const result = await emitMessageContracts({
      model: { version: '3.0.0', major: 3, channels: [{ key: 'silent', messages: [] }], issues: [] },
      writer: await createOutputWriter(await scratchDir()),
    })

    // Not even a barrel: an exported contract with no messages accepts no frame
    // in either direction, which is a trap rather than a document.
    expect(result.files).toEqual([])
    expect(result.channelCount).toBe(0)
    expect(result.issues[0]?.message).toMatch(/no message projected/)
  })

  it('reports the messages a channel could not project, and keeps the rest', async () => {
    // Slack renames every wire tag on its way into a message key, so only the
    // three messages whose payload agrees with their own name survive.
    const result = await emitMessageContracts({
      model: await modelOf('v3.0/slack-rtm.yaml'),
      writer: await createOutputWriter(await scratchDir()),
    })

    expect(result.messageCount).toBe(3)
    expect(result.channelCount).toBe(1)
    expect(result.issues.length).toBeGreaterThan(40)
  })

  it('regenerates the checked-in contracts byte for byte', async () => {
    for (const [fixture, dirName, discriminator] of [
      ['v3.0/websocket-gemini.yaml', 'gemini', 'event'],
      ['v3.0/slack-rtm.yaml', 'slack', undefined],
    ] as const) {
      const fresh = await emitInto(await modelOf(fixture), discriminator)
      const golden = join(GOLDEN_ROOT, dirName, CONTRACTS_DIR)

      const names = (await readdir(join(fresh, CONTRACTS_DIR))).sort()
      expect(names).toEqual((await readdir(golden)).sort())
      for (const name of names) {
        expect(await readContract(fresh, name)).toBe(await readFile(join(golden, name), 'utf-8'))
      }
    }
  })

  /**
   * The keystone. Everything above checks what the emitter *wrote*; this checks
   * that what it wrote is a contract `@amritk/api` accepts and a live connection
   * carries — projected from a real vendored document and run through the
   * runtime the whole feature exists to feed.
   *
   * `prepareMessages` is the proof that matters: it runs `assertMessageSchema`
   * over every emitted schema, which is exactly the check that refuses a payload
   * still declaring its discriminator, or one that could never be an object.
   */
  it('emits a contract the runtime accepts and a connection round-trips', async () => {
    // The freshly written bytes, loaded as a module and prepared — the round
    // trip below runs on the statically imported copy the test above pins to
    // these same bytes, because that copy is the one the compiler reads.
    const fresh = await emitInto(await modelOf('v3.0/websocket-gemini.yaml'), 'event')
    const emitted = (await import(join(fresh, CONTRACTS_DIR, 'market-data-v1.ts'))) as Record<string, unknown>
    expect(prepareMessages(emitted['marketDataV1Messages'] as AnyMessagesContract).discriminator).toBe('event')

    const prepared = prepareMessages(marketDataV1Messages)
    expect(prepared.discriminator).toBe('event')
    expect([...prepared.serverToClient.keys()]).toEqual(['marketData'])
    expect([...prepared.clientToServer.keys()]).toEqual([])

    // A heartbeat as the document's own example writes it, tagged with the
    // discriminator this run asked for. Gemini's `type` is the market schema's
    // own `oneOf` selector, not the message tag, so it stays in the payload —
    // which is the whole reason this document needs `--discriminator`.
    const heartbeat = { event: 'marketData', type: 'heartbeat', socket_sequence: 1656 } as const

    const socket = serverSocket()
    bindMessages(marketDataV1Messages, socket, { validateOutbound: true }).send(heartbeat)
    expect(socket.sent).toEqual([JSON.stringify(heartbeat)])

    const client = fakeWebSocket()
    const channel = await connectMessages(marketDataV1Messages, {
      url: 'wss://api.gemini.com/v1/marketdata/btcusd',
      transports: ['websocket'],
      webSocket: client.Fake,
    })
    // The exact bytes the server produced, delivered to the client end.
    client.current()?.emit('message', { data: socket.sent[0] })
    const received = await next(channel.messages)
    expect(received).toEqual(heartbeat)
    expectTypeOf(received).toExtend<{ event: 'marketData' } | undefined>()
    channel.close()
  })

  it('derives a union that narrows on the discriminator', async () => {
    const socket = serverSocket()
    const channel = bindMessages(rootMessages, socket)
    type Outbound = Parameters<typeof channel.send>[0]

    // Three of Slack's messages survive the tag renames, so this is a real
    // union — and it narrows only because each member carries the discriminator
    // as a *literal*, which it does only because the emitted schemas went out
    // with `as const` and the discriminator went out as a string literal.
    expectTypeOf<Outbound['type']>().toEqualTypeOf<'hello' | 'goodbye' | 'message'>()

    const textOf = (message: Outbound): string | undefined => (message.type === 'message' ? message.text : undefined)
    expect(textOf({ type: 'message', text: 'hi' })).toBe('hi')
    expect(textOf({ type: 'hello' })).toBeUndefined()

    // The payload's own fields narrow with it, straight off the emitted schema.
    channel.send({ type: 'message', text: 'hi', channel: 'C1' })
    expect(socket.sent).toEqual([JSON.stringify({ type: 'message', text: 'hi', channel: 'C1' })])
  })
})
