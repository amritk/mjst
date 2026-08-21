import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, expectTypeOf, it } from 'vitest'

import type { RefineInput, RefineIssue } from './client'
import * as client from './client'

/**
 * Collects every relative module reachable from an entry, plus the external
 * specifiers it touches, by reading the source files. This is what makes the
 * subpath a guarantee instead of a convention: if someone adds an import that
 * drags a server module (or a `node:` built-in) into the graph, the test
 * fails before a consumer's bundler starts printing externalization warnings.
 */
const walkImportGraph = (entry: string): { files: string[]; externals: string[] } => {
  const files = new Set<string>()
  const externals = new Set<string>()
  const visit = (moduleName: string): void => {
    const file = `${moduleName}.ts`
    if (files.has(file)) return
    files.add(file)
    // Comments go first — JSDoc examples contain import statements too.
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8').replace(
      /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
      '',
    )
    for (const match of source.matchAll(/(?:from|import)\s+'([^']+)'/g)) {
      const specifier = match[1] ?? ''
      if (specifier.startsWith('./')) visit(specifier.slice(2))
      else externals.add(specifier)
    }
  }
  visit(entry)
  return { files: [...files].sort(), externals: [...externals].sort() }
}

describe('client', () => {
  it('exports the browser-facing surface', () => {
    expect(client.createClient).toBeTypeOf('function')
    expect(client.defineContract).toBeTypeOf('function')
    expect(client.buildParamPath).toBeTypeOf('function')
    expect(client.toSearchParams).toBeTypeOf('function')
    expect(client.appendCookies).toBeTypeOf('function')
    expect(client.isMalformedBodyError).toBeTypeOf('function')
    expect(client.isUnexpectedStatusError).toBeTypeOf('function')
    expect(client.createCsrfHeader).toBeTypeOf('function')
    expect(client.createRefreshFetch).toBeTypeOf('function')
    expect(client.createTokenRefresh).toBeTypeOf('function')
    expect(client.decodeJwtExpiry).toBeTypeOf('function')
    expect(client.formBodySerializer.bodyType).toBe('form')
    expect(client.multipartBodySerializer.bodyType).toBe('multipart')
  })

  /**
   * `refine` is a field of the browser-safe `Contract`, and the bundler strip
   * only removes its body from browser builds — so a shared contracts file
   * that lifts the hook out into a named function has to be able to name its
   * input and issue types from this entry, not only from the root barrel. The
   * type-only imports above are the real guard: dropping either export turns
   * this file into a `types:check` failure.
   */
  it('exports the refine hook types a shared contracts file needs', () => {
    const bodySchema = {
      type: 'object',
      properties: { start: { type: 'integer' }, end: { type: 'integer' } },
      required: ['start', 'end'],
    } as const
    const startsBeforeEnd = (
      input: RefineInput<undefined, undefined, typeof bodySchema, undefined, undefined>,
    ): readonly RefineIssue[] | undefined => {
      expectTypeOf(input.body.start).toEqualTypeOf<number>()
      return input.body.start < input.body.end ? undefined : [{ path: '/start', message: 'start must precede end' }]
    }
    const contract = client.defineContract({
      method: 'post',
      path: '/ranges',
      request: { body: bodySchema },
      refine: startsBeforeEnd,
      responses: { 204: {} },
    })
    const slots = {
      params: undefined,
      query: undefined,
      body: { start: 2, end: 1 },
      headers: undefined,
      cookies: undefined,
    }
    expect(contract.refine?.(slots)).toEqual([{ path: '/start', message: 'start must precede end' }])
  })

  it('keeps the transitive import graph free of node built-ins and server modules', () => {
    const { files, externals } = walkImportGraph('client')
    // The only external is the validator package — type-only for schema
    // inference, and a real import for `connectMessages`, which validates
    // inbound frames in the browser. It is eval-free and depends on no
    // `node:` built-in, so it bundles; anything else here — above all a
    // `node:` built-in — would break browser bundles.
    expect(externals).toEqual(['@amritk/runtime-validators'])
    // The exact reachable set, so a new import that pulls in the server half
    // of the package shows up as a diff here rather than as a bundler warning.
    expect(files).toEqual([
      'append-cookies.ts',
      'build-param-path.ts',
      'client-errors.ts',
      'client.ts',
      'connect-messages.ts',
      'connect-realtime.ts',
      'create-bearer-session.ts',
      'create-client.ts',
      'create-csrf-header.ts',
      'create-message-queue.ts',
      'create-refresh-fetch.ts',
      'create-token-refresh.ts',
      'decode-jwt-expiry.ts',
      'define-contract.ts',
      'form-body-serializer.ts',
      'message-channel.ts',
      'message-contracts.ts',
      'multipart-body-serializer.ts',
      'realtime-framing.ts',
      'sse-item-schema.ts',
      'to-search-params.ts',
      'types.ts',
    ])
  })
})
