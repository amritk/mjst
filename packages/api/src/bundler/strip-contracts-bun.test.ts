import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * End-to-end size test for the whole story: a realistic JSON-only,
 * static-path widget (the agent-ummo shape — three contracts, fat schemas,
 * summaries, refine) is bundled with real `Bun.build`, with and without the
 * plugin. The plugin must cut the bundle substantially and no freight string
 * may survive into the stripped output. Runs in a spawned `bun` process
 * because `Bun.build` does not exist under the Node-based vitest runtime.
 */

const here = dirname(fileURLToPath(import.meta.url))
const sourceDir = join(here, '..')

const contractsModule = `import { defineContract } from '${join(sourceDir, 'define-contract')}'

const messageSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Server-assigned message id (freight-sentinel-schema)' },
    role: { type: 'string', enum: ['user', 'assistant'] },
    text: { type: 'string', maxLength: 10000 },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'role', 'text', 'createdAt'],
} as const

export const getConversation = defineContract({
  method: 'get',
  path: '/conversation',
  summary: 'Read the visitor conversation (freight-sentinel-summary)',
  description: 'Returns the full message history for the widget session.',
  tags: ['widget'],
  responses: {
    200: {
      description: 'The conversation payload',
      body: { type: 'object', properties: { messages: { type: 'array', items: messageSchema } }, required: ['messages'] },
    },
    404: {},
  },
})

export const sendMessage = defineContract({
  method: 'post',
  path: '/messages',
  summary: 'Send a visitor message',
  request: {
    body: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 10000 } }, required: ['text'] },
  },
  refine: ({ body }) => (body.text.trim() === '' ? [{ path: '/text', message: 'blank message (freight-sentinel-refine)' }] : undefined),
  responses: {
    201: { body: messageSchema },
    402: {
      body: {
        type: 'object',
        properties: { error: { type: 'string' }, used: { type: 'integer' }, remaining: { type: 'integer' } },
        required: ['error', 'used', 'remaining'],
      },
    },
  },
})

export const getStatus = defineContract({
  method: 'get',
  path: '/status',
  summary: 'Widget health/status probe',
  responses: {
    200: { body: { type: 'object', properties: { online: { type: 'boolean' } }, required: ['online'] } },
  },
})
`

const entryModule = `import { createClient } from '${join(sourceDir, 'create-client')}'
import * as contracts from './contracts'

export const client = createClient(contracts, 'https://api.example.com')
`

const buildScript = `import { stripContractsBun } from '${join(here, 'strip-contracts-bun')}'

const bundle = async (entry: string, strip: boolean) => {
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    minify: true,
    write: false,
    plugins: strip ? [stripContractsBun()] : [],
  })
  if (!result.success) throw new Error(result.logs.map(String).join('\\n'))
  const text = (await result.outputs[0]?.text()) as string
  return { size: text.length, gzip: Bun.gzipSync(new TextEncoder().encode(text)).byteLength, text }
}

const [contractsEntry, clientEntry] = [process.argv[2] as string, process.argv[3] as string]
const contractsBaseline = await bundle(contractsEntry, false)
const contractsStripped = await bundle(contractsEntry, true)
const appBaseline = await bundle(clientEntry, false)
const appStripped = await bundle(clientEntry, true)
console.log(
  JSON.stringify({
    contractsBaseline: contractsBaseline.size,
    contractsStripped: contractsStripped.size,
    appBaseline: appBaseline.size,
    appBaselineGzip: appBaseline.gzip,
    appStripped: appStripped.size,
    appStrippedGzip: appStripped.gzip,
    appStrippedText: appStripped.text,
  }),
)
`

type SizeReport = {
  readonly contractsBaseline: number
  readonly contractsStripped: number
  readonly appBaseline: number
  readonly appBaselineGzip: number
  readonly appStripped: number
  readonly appStrippedGzip: number
  readonly appStrippedText: string
}

describe('strip-contracts-bun', () => {
  it('shrinks a real browser bundle and strips every freight string', () => {
    const fixtureDir = join(here, '.fixtures')
    mkdirSync(fixtureDir, { recursive: true })
    try {
      writeFileSync(join(fixtureDir, 'contracts.ts'), contractsModule)
      writeFileSync(join(fixtureDir, 'client.ts'), entryModule)
      writeFileSync(join(fixtureDir, 'build.ts'), buildScript)

      const run = spawnSync(
        'bun',
        [join(fixtureDir, 'build.ts'), join(fixtureDir, 'contracts.ts'), join(fixtureDir, 'client.ts')],
        {
          encoding: 'utf-8',
          timeout: 60_000,
        },
      )
      expect(run.error).toBeUndefined()
      expect(run.status, run.stderr).toBe(0)
      const report = JSON.parse(run.stdout) as SizeReport

      // The contracts module alone is what the plugin acts on, and its freight
      // scales with route count — the strip must remove well over half of it.
      expect(report.contractsStripped).toBeLessThan(report.contractsBaseline * 0.5)
      // The full app (client + contracts) must shrink too, min and gzip both.
      expect(report.appStripped).toBeLessThan(report.appBaseline * 0.8)
      expect(report.appStrippedGzip).toBeLessThan(report.appBaselineGzip)

      // Nothing the client never reads may survive: schemas (including ones
      // referenced through a shared const), summaries, refine bodies.
      for (const freight of ['freight-sentinel-schema', 'freight-sentinel-summary', 'freight-sentinel-refine']) {
        expect(report.appStrippedText).not.toContain(freight)
      }
      // What the client does read must survive.
      for (const kept of ['/conversation', '/messages', '/status']) {
        expect(report.appStrippedText).toContain(kept)
      }
      // JSON-only and static-path: the opt-in wire formats must not be here.
      for (const optIn of ['FormData', 'Missing path parameter']) {
        expect(report.appStrippedText).not.toContain(optIn)
      }
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  })
})
