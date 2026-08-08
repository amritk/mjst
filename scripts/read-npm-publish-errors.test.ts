import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readNpmPublishErrors, redact } from './read-npm-publish-errors'

/** A publish that 403'd, in the shape and order npm writes its debug log. */
const FAILED_LOG = [
  '0 verbose cli /opt/hostedtoolcache/node/24.18.0/x64/bin/node',
  '1 info using npm@11.16.0',
  '2 silly config load:file:/home/runner/.npmrc',
  '3 silly logfile start cleaning logs, removing 1 files',
  '4 silly packumentCache heap:8640266240 maxSize:2160066560',
  '5 http fetch POST 201 https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/@amritk%2fmjst 412ms',
  '6 http fetch PUT 403 https://registry.npmjs.org/@amritk%2fmjst 908ms',
  '7 verbose headers { "npm-notice": "the reason we are looking for" }',
  '8 error code E403',
  '',
].join('\n')

const CLEAN_LOG = [
  '0 verbose cli /opt/hostedtoolcache/node/24.18.0/x64/bin/node',
  '1 http fetch PUT 200 https://registry.npmjs.org/@amritk%2fhelpers 811ms',
  '2 info ok',
  '',
].join('\n')

describe('read-npm-publish-errors', () => {
  let logsDir: string

  beforeAll(async () => {
    logsDir = await mkdtemp(join(tmpdir(), 'mjst-npm-logs-'))
    await writeFile(join(logsDir, '2026-08-08T07_24_48_202Z-debug-0.log'), FAILED_LOG, 'utf-8')
    await writeFile(join(logsDir, '2026-08-08T07_24_49_100Z-debug-0.log'), CLEAN_LOG, 'utf-8')
  })

  afterAll(async () => {
    await rm(logsDir, { recursive: true, force: true })
  })

  it('returns only the logs that recorded a failed request', async () => {
    const failures = await readNpmPublishErrors(logsDir)
    expect(failures.map(({ file }) => file)).toEqual(['2026-08-08T07_24_48_202Z-debug-0.log'])
  })

  // The whole point is the line npm never prints to the job log, so the filter
  // has to keep the exchange, the PUT, and whatever the registry said with it.
  it('keeps the token exchange, the failed request, and the registry response', async () => {
    const [failure] = await readNpmPublishErrors(logsDir)
    expect(failure?.lines).toEqual([
      '0 verbose cli /opt/hostedtoolcache/node/24.18.0/x64/bin/node',
      '1 info using npm@11.16.0',
      '5 http fetch POST 201 https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/@amritk%2fmjst 412ms',
      '6 http fetch PUT 403 https://registry.npmjs.org/@amritk%2fmjst 908ms',
      '7 verbose headers { "npm-notice": "the reason we are looking for" }',
      '8 error code E403',
    ])
  })

  it('drops the boilerplate every npm run writes', async () => {
    const [failure] = await readNpmPublishErrors(logsDir)
    expect(failure?.lines.some((line) => line.includes('silly'))).toBe(false)
  })

  it('returns nothing when the logs directory does not exist', async () => {
    expect(await readNpmPublishErrors(join(logsDir, 'missing'))).toEqual([])
  })

  // An exchanged npm token is a live publish credential for its package, and a
  // GitHub ID token buys one — neither belongs in a job log a public repo shows.
  it('redacts a GitHub ID token', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJyZXBvc2l0b3J5IjoiYW1yaXRrL21qc3QifQ.c2lnbmF0dXJl'
    expect(redact(`10 silly exchanging ${jwt} for a token`)).toBe('10 silly exchanging [redacted jwt] for a token')
  })

  it('redacts an npm token and an authorization header', () => {
    expect(redact('11 http request npm_abcdefghijklmnopqrstuvwxyz012345')).toBe('11 http request [redacted token]')
    expect(redact('12 http headers authorization: Bearer somethingsecret')).toBe(
      '12 http headers authorization: [redacted] somethingsecret',
    )
  })

  it('keeps the prose around a redacted credential', () => {
    expect(redact('13 http fetch PUT 403 https://registry.npmjs.org/@amritk%2fmjst 908ms')).toBe(
      '13 http fetch PUT 403 https://registry.npmjs.org/@amritk%2fmjst 908ms',
    )
  })
})
