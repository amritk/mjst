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

  it('resolves a cross-file $ref to a plain-name $anchor', async () => {
    writeFileSync(join(dir, 'pet.json'), JSON.stringify({ defs: { Pet: { $anchor: 'pet', type: 'object' } } }))
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ schemas: { Pet: { $ref: './pet.json#pet' } } }))

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'))

    expect(errors).toEqual([])
    expect(resolved).toEqual({ schemas: { Pet: { $anchor: 'pet', type: 'object' } } })
  })

  it('inlines a $dynamicRef bound to a $dynamicAnchor across files', async () => {
    writeFileSync(join(dir, 'base.json'), JSON.stringify({ Node: { $dynamicAnchor: 'node', type: 'object' } }))
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ schema: { $dynamicRef: './base.json#node' } }))

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'))

    expect(errors).toEqual([])
    expect(resolved).toEqual({ schema: { $dynamicAnchor: 'node', type: 'object' } })
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

  it('re-checks the SSRF policy on a session-cache hit (cache must not leak across options)', async () => {
    const url = 'http://10.0.0.5/s.json'
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ Foo: { type: 'string' } }), { status: 200 }))
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: `${url}#/Foo` } }))

    // A permissive call fetches and caches the private-host document.
    const permissive = await resolveRefsFromFile(join(dir, 'api.json'), { allowPrivateHosts: true })
    expect(permissive.errors).toEqual([])
    expect(permissive.resolved).toMatchObject({ x: { type: 'string' } })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // A later strict call for the same URL must NOT be served from the session
    // cache — the default private-host guard has to refuse it.
    const strict = await resolveRefsFromFile(join(dir, 'api.json'))
    expect((strict.resolved as { x: unknown }).x).toBeUndefined()
    expect(strict.errors[0]?.message).toMatch(/Refusing to resolve remote \$ref/)
    // No additional fetch was made for the refused call.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps a same-document cycle as a root-relative $ref', async () => {
    writeFileSync(
      join(dir, 'root.json'),
      JSON.stringify({
        $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } } },
        properties: { head: { $ref: '#/$defs/node' } },
      }),
    )

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'root.json'))

    expect(errors).toEqual([])
    const head = (resolved as { properties: { head: { properties: { next: unknown } } } }).properties.head
    // The recursive branch survives as a ref that resolves within the output.
    expect(head.properties.next).toEqual({ $ref: '#/$defs/node' })
  })

  it('hoists a cross-file cycle target into $defs instead of collapsing to {}', async () => {
    writeFileSync(
      join(dir, 'a.json'),
      JSON.stringify({ Node: { type: 'object', properties: { next: { $ref: './b.json#/BNode' } } } }),
    )
    writeFileSync(
      join(dir, 'b.json'),
      JSON.stringify({ BNode: { type: 'object', properties: { back: { $ref: './a.json#/Node' } } } }),
    )
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: './a.json#/Node' } }))

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'))

    expect(errors).toEqual([])
    const tree = resolved as {
      x: { type: string; properties: { next: { properties: { back: unknown } } } }
      $defs: Record<string, { type: string }>
    }
    expect(tree.x.type).toBe('object')
    // The cycle leg points at a hoisted $defs entry rather than an empty stub…
    expect(tree.x.properties.next.properties.back).toEqual({ $ref: '#/$defs/Node' })
    // …and the hoisted definition carries the real resolved shape.
    expect(tree.$defs['Node']?.type).toBe('object')
  })

  it('inlines annotation-only siblings (summary/description) as overrides, not allOf', async () => {
    // OpenAPI 3.1 Reference Objects allow only summary/description siblings and
    // they override the target's — an allOf wrapper is invalid in that position.
    writeFileSync(
      join(dir, 'pet.json'),
      JSON.stringify({ Pet: { type: 'object', description: 'from target', title: 'Pet' } }),
    )
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({ schemas: { Pet: { $ref: './pet.json#/Pet', description: 'local', summary: 'a pet' } } }),
    )

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'))

    expect(errors).toEqual([])
    expect(resolved).toEqual({
      schemas: { Pet: { type: 'object', title: 'Pet', description: 'local', summary: 'a pet' } },
    })
  })

  it('sends caller-supplied headers, but not across a cross-origin redirect', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: 'https://cdn.example.com/s.json' } }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ Foo: { type: 'string' } }), { status: 200 }))
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: 'https://api.example.com/s.json#/Foo' } }))

    const { errors } = await resolveRefsFromFile(join(dir, 'api.json'), {
      allowedHosts: ['api.example.com', 'cdn.example.com'],
      headers: { authorization: 'Bearer secret' },
    })

    expect(errors).toEqual([])
    // First (same-origin) hop carries the headers…
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: 'Bearer secret' } })
    // …the cross-origin redirect hop must not, or the token would leak.
    expect(Object.keys(fetchSpy.mock.calls[1]?.[1] ?? {})).not.toContain('headers')
  })

  it('uses a custom fetch implementation while still enforcing the SSRF guard', async () => {
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch')
    const customFetch = vi
      .fn<(url: string, init: object) => Promise<Response>>()
      .mockResolvedValue(new Response(JSON.stringify({ Foo: { type: 'string' } }), { status: 200 }))
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({
        ok: { $ref: 'https://api.example.com/s.json#/Foo' },
        bad: { $ref: 'http://169.254.169.254/meta#/foo' },
      }),
    )

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'), {
      allowedHosts: ['api.example.com'],
      fetch: customFetch,
    })

    expect(resolved).toMatchObject({ ok: { type: 'string' } })
    // The custom fetch served the allowed host; the global fetch was never used.
    expect(customFetch).toHaveBeenCalledTimes(1)
    expect(globalFetchSpy).not.toHaveBeenCalled()
    // The denied host was refused before the custom fetch could be called.
    expect(errors.some((e) => /Refusing to resolve remote \$ref/.test(e.message))).toBe(true)
  })

  it('honors maxRedirects', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 301, headers: { location: 'https://api.example.com/s.json' } }))
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: 'https://api.example.com/s.json#/Foo' } }))

    const { errors } = await resolveRefsFromFile(join(dir, 'api.json'), {
      allowedHosts: ['api.example.com'],
      maxRedirects: 1,
    })

    expect(errors[0]?.message).toMatch(/too many redirects \(>1\)/)
    // The initial request plus exactly one followed redirect.
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('honors maxBytes for remote documents', async () => {
    const body = JSON.stringify({ Foo: { type: 'string', description: 'x'.repeat(200) } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, { status: 200, headers: { 'content-length': String(body.length) } }),
    )
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: 'https://api.example.com/s.json#/Foo' } }))

    const { errors } = await resolveRefsFromFile(join(dir, 'api.json'), {
      allowedHosts: ['api.example.com'],
      maxBytes: 64,
    })

    expect(errors[0]?.message).toMatch(/exceeds 64 bytes/)
  })

  it('bypasses the session cache with cache: false', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ Foo: { type: 'string' } }), { status: 200 })),
      )
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: 'https://api.example.com/s.json#/Foo' } }))
    const opts = { allowedHosts: ['api.example.com'] }

    // Two cache-bypassing calls fetch independently and store nothing…
    await resolveRefsFromFile(join(dir, 'api.json'), { ...opts, cache: false })
    await resolveRefsFromFile(join(dir, 'api.json'), { ...opts, cache: false })
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    // …so a subsequent caching call fetches once more, then is served cached.
    await resolveRefsFromFile(join(dir, 'api.json'), opts)
    await resolveRefsFromFile(join(dir, 'api.json'), opts)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
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
