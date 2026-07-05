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

  it('keeps keywords sibling to a cross-file $ref via an allOf', async () => {
    writeFileSync(join(dir, 'pet.json'), JSON.stringify({ Pet: { type: 'object' } }))
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({ schemas: { Pet: { $ref: './pet.json#/Pet', required: ['name'] } } }),
    )

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'))

    expect(errors).toEqual([])
    expect(resolved).toEqual({ schemas: { Pet: { required: ['name'], allOf: [{ type: 'object' }] } } })
  })

  it('prefetches a cross-file $ref that appears in a $ref node sibling', async () => {
    writeFileSync(join(dir, 'name.json'), JSON.stringify({ Name: { type: 'string' } }))
    writeFileSync(join(dir, 'base.json'), JSON.stringify({ Base: { type: 'object' } }))
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({
        Thing: { $ref: './base.json#/Base', properties: { name: { $ref: './name.json#/Name' } } },
      }),
    )

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'))

    expect(errors).toEqual([])
    expect(resolved).toEqual({
      Thing: { properties: { name: { type: 'string' } }, allOf: [{ type: 'object' }] },
    })
  })

  it('omits the origin map unless trackOrigins is set', async () => {
    writeFileSync(join(dir, 'root.json'), JSON.stringify({ a: { $ref: '#/b' }, b: { value: 1 } }))

    const result = await resolveRefsFromFile(join(dir, 'root.json'))

    expect(result.origins).toBeUndefined()
  })

  it('stamps inlined nodes with their origin document and in-file path', async () => {
    const petPath = join(dir, 'pet.json')
    const apiPath = join(dir, 'api.json')
    writeFileSync(petPath, JSON.stringify({ Pet: { type: 'object', properties: { name: { type: 'string' } } } }))
    writeFileSync(
      apiPath,
      JSON.stringify({
        components: { schemas: { Pet: { $ref: './pet.json#/Pet' }, Pet2: { $ref: './pet.json#/Pet' } } },
        widget: { type: 'object' },
        useWidget: { $ref: '#/widget' },
      }),
    )

    const { resolved, origins } = await resolveRefsFromFile(apiPath, { trackOrigins: true })
    expect(origins).toBeDefined()
    const tree = resolved as {
      components: { schemas: { Pet: object; Pet2: object } }
      useWidget: object
    }

    // The cross-file node is stamped with pet.json and its in-file path; both call
    // sites share the one inlined object, so the stamp identifies the definition.
    expect(tree.components.schemas.Pet).toBe(tree.components.schemas.Pet2)
    expect(origins?.get(tree.components.schemas.Pet)).toEqual({ location: petPath, pointer: ['Pet'] })

    // An internal ref is stamped against the root document at the target path.
    expect(origins?.get(tree.useWidget)).toEqual({ location: apiPath, pointer: ['widget'] })
  })

  it('keeps the definition origin when a node is reached through a chained ref (first-write-wins)', async () => {
    const petPath = join(dir, 'pet.json')
    const apiPath = join(dir, 'api.json')
    writeFileSync(petPath, JSON.stringify({ Pet: { type: 'object' } }))
    writeFileSync(
      apiPath,
      JSON.stringify({
        components: { schemas: { Pet: { $ref: './pet.json#/Pet' } } },
        // Resolves through the internal ref to the same pet.json object.
        alias: { $ref: '#/components/schemas/Pet' },
      }),
    )

    const { resolved, origins } = await resolveRefsFromFile(apiPath, { trackOrigins: true })
    const tree = resolved as { components: { schemas: { Pet: object } }; alias: object }

    // `alias` resolves through to the same object; its origin stays the pet.json
    // definition rather than the intermediate root-document pointer.
    expect(tree.alias).toBe(tree.components.schemas.Pet)
    expect(origins?.get(tree.alias)).toEqual({ location: petPath, pointer: ['Pet'] })
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

  it('refuses a redirect that lands on a private host (SSRF via redirect)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }),
      )
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: 'https://api.example.com/s.json#/Foo' } }))

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'), {
      allowedHosts: ['api.example.com'],
    })

    expect((resolved as { x: unknown }).x).toBeUndefined()
    expect(errors[0]?.message).toMatch(/refusing to follow redirect/i)
    // The initial host was allowed, so the first request happened — but the
    // redirect target was re-checked and refused before any second request.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/s.json',
      expect.objectContaining({ redirect: 'manual' }),
    )
  })

  it('refuses a redirect to a file:// URL (SSRF local file disclosure)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: 'file:///etc/passwd' } }))
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: 'https://api.example.com/s.json#/Foo' } }))

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'), {
      allowedHosts: ['api.example.com'],
    })

    expect((resolved as { x: unknown }).x).toBeUndefined()
    expect(errors[0]?.message).toMatch(/unsupported URL protocol/i)
    // Only the initial https request happened; the file:// target was refused.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('follows a redirect to another allowed host', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: 'https://cdn.example.com/s.json' } }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ Foo: { type: 'string' } }), { status: 200 }))
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: 'https://api.example.com/s.json#/Foo' } }))

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'), {
      allowedHosts: ['api.example.com', 'cdn.example.com'],
    })

    expect(errors).toEqual([])
    expect(resolved).toMatchObject({ x: { type: 'string' } })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('coalesces two concurrent resolves of the same remote URL into one fetch', async () => {
    let resolveFetch: ((r: Response) => void) | undefined
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((res) => {
          resolveFetch = res
        }),
    )
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: 'https://api.example.com/s.json#/Foo' } }))

    // Two passes start before either fetch settles — they must share one request.
    const pass1 = resolveRefsFromFile(join(dir, 'api.json'), { allowedHosts: ['api.example.com'] })
    const pass2 = resolveRefsFromFile(join(dir, 'api.json'), { allowedHosts: ['api.example.com'] })
    await Promise.resolve()
    resolveFetch?.(new Response(JSON.stringify({ Foo: { type: 'string' } }), { status: 200 }))

    const [r1, r2] = await Promise.all([pass1, pass2])
    expect(r1.errors).toEqual([])
    expect(r2.errors).toEqual([])
    expect(r1.resolved).toMatchObject({ x: { type: 'string' } })
    expect(r2.resolved).toMatchObject({ x: { type: 'string' } })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
