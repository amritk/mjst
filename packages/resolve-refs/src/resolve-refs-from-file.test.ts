import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearRemoteCache, resolveRefsFromFile } from './resolve-refs-from-file'

describe('resolve-refs-from-file', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'resolve-refs-'))
    clearRemoteCache()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('inlines a cross-file $ref between local documents', async () => {
    writeFileSync(
      join(dir, 'pet.json'),
      JSON.stringify({ Pet: { type: 'object', properties: { name: { type: 'string' } } } }),
    )
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({ components: { schemas: { Pet: { $ref: './pet.json#/Pet' } } } }),
    )

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'))

    expect(errors).toEqual([])
    expect(resolved).toMatchObject({
      components: { schemas: { Pet: { type: 'object', properties: { name: { type: 'string' } } } } },
    })
  })

  it('inlines an internal $ref within a single document', async () => {
    writeFileSync(join(dir, 'root.json'), JSON.stringify({ a: { $ref: '#/b' }, b: { value: 1 } }))

    const { resolved } = await resolveRefsFromFile(join(dir, 'root.json'))

    expect(resolved).toMatchObject({ a: { value: 1 }, b: { value: 1 } })
  })

  it('records an error and degrades to {} when a referenced file is missing', async () => {
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: './missing.json#/Nope' } }))

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'))

    // The missing document degrades to {}, so the pointer into it misses and the
    // ref resolves to undefined — the important part is that we recorded the
    // failure instead of throwing.
    expect((resolved as { x: unknown }).x).toBeUndefined()
    expect(errors.length).toBeGreaterThan(0)
  })

  it('refuses a remote $ref to a private host by default (SSRF guard)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({ x: { $ref: 'http://169.254.169.254/latest/meta-data#/foo' } }),
    )

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'))

    // The refused document degrades to {}, so the pointer into it misses.
    expect((resolved as { x: unknown }).x).toBeUndefined()
    expect(errors[0]?.message).toMatch(/Refusing to resolve remote \$ref/)
    // The guard is syntactic — we never even attempt the request.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses any remote $ref when remote resolution is disabled', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: 'https://example.com/s.json#/Foo' } }))

    const { errors } = await resolveRefsFromFile(join(dir, 'api.json'), { remote: false })

    expect(errors[0]?.message).toMatch(/remote \$ref resolution is disabled/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('uses a custom parse callback to load non-JSON (e.g. YAML) documents', async () => {
    // Real YAML that JSON.parse would reject — a custom callback handles it.
    writeFileSync(join(dir, 'contact.yaml'), 'type: object\nproperties:\n  name:\n    type: string\n')
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ contact: { $ref: './contact.yaml' } }))

    const parse = (content: string, location: string): unknown => {
      if (/\.ya?ml$/i.test(location)) return { type: 'object', properties: { name: { type: 'string' } } }
      return JSON.parse(content) as unknown
    }

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'), { parse })

    expect(errors).toEqual([])
    expect(resolved).toMatchObject({ contact: { type: 'object', properties: { name: { type: 'string' } } } })
  })

  it('fetches an allow-listed remote $ref and caches it for the session', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ Foo: { type: 'string' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({
        a: { $ref: 'https://api.example.com/s.json#/Foo' },
        b: { $ref: 'https://api.example.com/s.json#/Foo' },
      }),
    )

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'), {
      allowedHosts: ['api.example.com'],
    })

    expect(errors).toEqual([])
    expect(resolved).toMatchObject({ a: { type: 'string' }, b: { type: 'string' } })
    // Both refs hit the same document, which is fetched and cached exactly once.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
