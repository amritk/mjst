import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validate } from '@amritk/runtime-validators'
import { afterAll, describe, expect, it } from 'vitest'

import { loadSuiteCases, type SuiteCase } from '../../../fixtures/json-schema-test-suite/load-suite'
import { resolveRefsFromFile } from './resolve-refs-from-file'
import type { ResolveOptions } from './types'

/**
 * Holds the `bundle` option to the same bar as inlining, over the JSON Schema
 * Test Suite's cross-document cases: the ones whose schema reaches a document on
 * the suite's `http://localhost:1234` remote server, served here from
 * `fixtures/json-schema-test-suite/remotes` through the resolver's `fetch` hook.
 *
 * Bundling keeps references the validator then follows inside one document, so
 * a mistake shows as a different verdict — a ref pointed at the wrong hoist, a
 * hoist that never landed. Every case inlining answers correctly has to be
 * answered correctly bundled too, with the same errors reported.
 */

const REMOTES = new URL('../../../fixtures/json-schema-test-suite/remotes/', import.meta.url).pathname
const REMOTE_HOST = 'localhost:1234'

/** Whether the schema names a document on the suite's remote server anywhere. */
const reachesRemote = (value: unknown): boolean => JSON.stringify(value).includes(`http://${REMOTE_HOST}/`)

/** Serves the suite's remotes directory in place of its `localhost:1234` server. */
const serveRemotes: ResolveOptions['fetch'] = async (url) => {
  const { host, pathname } = new URL(url)
  if (host !== REMOTE_HOST) return new Response(null, { status: 404 })
  try {
    return new Response(readFileSync(join(REMOTES, pathname), 'utf8'), { status: 200 })
  } catch {
    return new Response(null, { status: 404 })
  }
}

const dir = mkdtempSync(join(tmpdir(), 'bundle-conformance-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** The interpreter's verdict, or `null` when it cannot reach one. */
const verdict = (schema: unknown, data: unknown): boolean | null => {
  try {
    return validate(schema)(data) === true
  } catch {
    return null
  }
}

/** Resolves one case's schema from a file, inlining or bundling. */
const resolveCase = async (testCase: SuiteCase, index: number, bundle: boolean) => {
  const file = join(dir, `case-${index}.json`)
  writeFileSync(file, JSON.stringify(testCase.schema))
  return resolveRefsFromFile(file, {
    allowedHosts: [REMOTE_HOST],
    fetch: serveRemotes,
    cache: false,
    bundle,
  })
}

const CASES = loadSuiteCases().filter((testCase) => reachesRemote(testCase.schema))

describe('bundle-conformance', () => {
  it('covers the suite cross-document cases', () => {
    expect(CASES.length).toBeGreaterThan(40)
  })

  it('answers every case inlining answers, and reports the same errors', async () => {
    const regressions: string[] = []
    const preserved: string[] = []
    for (const [index, testCase] of CASES.entries()) {
      const inlined = await resolveCase(testCase, index, false)
      if (verdict(inlined.resolved, testCase.data) !== testCase.valid) continue
      preserved.push(testCase.key)
      const bundled = await resolveCase(testCase, index, true)
      if (verdict(bundled.resolved, testCase.data) !== testCase.valid) regressions.push(`${testCase.key}: verdict`)
      const messages = (result: typeof inlined) => result.errors.map((error) => error.message)
      if (JSON.stringify(messages(bundled)) !== JSON.stringify(messages(inlined))) {
        regressions.push(`${testCase.key}: errors`)
      }
    }
    expect(preserved.length).toBeGreaterThan(30)
    expect(regressions).toEqual([])
  })
})
