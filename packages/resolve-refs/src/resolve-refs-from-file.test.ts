import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

  it('leaves a $ref-shaped object in instance data alone, and never loads what it names', async () => {
    // `enum` holds values: this one is an object that happens to have a `$ref`
    // key. Inlining it would change the schema, and fetching the document it
    // names would turn a literal into a network request.
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    writeFileSync(join(dir, 'pet.json'), JSON.stringify({ Pet: { type: 'object' } }))
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({
        properties: { kind: { enum: [{ $ref: './pet.json#/Pet' }, { $ref: 'https://example.com/s.json#/Foo' }] } },
      }),
    )

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'))

    expect(errors).toEqual([])
    expect(resolved).toEqual({
      properties: { kind: { enum: [{ $ref: './pet.json#/Pet' }, { $ref: 'https://example.com/s.json#/Foo' }] } },
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('resolves a cross-file $ref under a definition named after a value keyword', async () => {
    // Under `$defs` the key `enum` is a name, so what it holds is still a schema.
    writeFileSync(join(dir, 'pet.json'), JSON.stringify({ Pet: { type: 'object' } }))
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ $defs: { enum: { $ref: './pet.json#/Pet' } } }))

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'))

    expect(errors).toEqual([])
    expect(resolved).toEqual({ $defs: { enum: { type: 'object' } } })
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

    // The document never loaded, so there is nothing to inline. The node keeps
    // its `$ref` rather than becoming `undefined`: an inlined `undefined`
    // vanishes on serialization (and becomes `null` inside an array, which is
    // not a schema at all), taking every constraint on the node with it.
    expect((resolved as { x: unknown }).x).toEqual({ $ref: './missing.json#/Nope' })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('refuses a remote $ref to a private host by default (SSRF guard)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({ x: { $ref: 'http://169.254.169.254/latest/meta-data#/foo' } }),
    )

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'))

    // Refused, so nothing is inlined — the node keeps its `$ref` and the
    // refusal is on `errors`.
    expect((resolved as { x: unknown }).x).toEqual({ $ref: 'http://169.254.169.254/latest/meta-data#/foo' })
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

    expect((resolved as { x: unknown }).x).toEqual({ $ref: 'https://api.example.com/s.json#/Foo' })
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

    expect((resolved as { x: unknown }).x).toEqual({ $ref: 'https://api.example.com/s.json#/Foo' })
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
    expect((strict.resolved as { x: unknown }).x).toEqual({ $ref: `${url}#/Foo` })
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

  it('refuses a local $ref that escapes the root document directory', async () => {
    // The path-traversal read this guard exists for: the spec sits in a
    // subfolder and reaches up into a file it has no business reading.
    const sub = join(dir, 'sub')
    mkdirSync(sub)
    writeFileSync(join(dir, 'secret.json'), JSON.stringify({ apiKey: 'SUPER-SECRET-VALUE' }))
    writeFileSync(join(sub, 'spec.json'), JSON.stringify({ leak: { $ref: '../secret.json' } }))

    const { resolved, errors } = await resolveRefsFromFile(join(sub, 'spec.json'))

    // The secret never reaches the output. The node keeps its `$ref` rather
    // than degrading to `{}` — an empty schema accepts anything, so inlining
    // one turns a refused constraint into a hole that validates everything.
    expect(resolved).toEqual({ leak: { $ref: '../secret.json' } })
    expect(JSON.stringify(resolved)).not.toContain('SUPER-SECRET-VALUE')
    expect(errors[0]?.message).toMatch(/Refusing to read local \$ref/)
    // The error names the escape hatch so the fix is obvious from the message.
    expect(errors[0]?.message).toMatch(/allowedRoots/)
  })

  it('refuses an absolute local $ref outside the root document directory', async () => {
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ a: { $ref: '/etc/passwd' } }))

    const { errors } = await resolveRefsFromFile(join(dir, 'api.json'))

    expect(errors[0]?.message).toMatch(/Refusing to read local \$ref .*\/etc\/passwd/)
  })

  it('allows a cross-directory local $ref when allowedRoots opts in', async () => {
    // The normal split-spec layout: a version folder referencing shared schemas.
    const sub = join(dir, 'sub')
    mkdirSync(sub)
    writeFileSync(join(dir, 'common.json'), JSON.stringify({ Pet: { type: 'object' } }))
    writeFileSync(join(sub, 'spec.json'), JSON.stringify({ pet: { $ref: '../common.json#/Pet' } }))

    const { resolved, errors } = await resolveRefsFromFile(join(sub, 'spec.json'), { allowedRoots: [dir] })

    expect(errors).toEqual([])
    expect(resolved).toEqual({ pet: { type: 'object' } })
  })

  it('refuses every cross-file local $ref when localRefs is disabled', async () => {
    writeFileSync(join(dir, 'pet.json'), JSON.stringify({ Pet: { type: 'object' } }))
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({ pet: { $ref: './pet.json#/Pet' }, internal: { $ref: '#/pet' } }),
    )

    const { errors } = await resolveRefsFromFile(join(dir, 'api.json'), { localRefs: false })

    expect(errors[0]?.message).toMatch(/local \$ref resolution is disabled/)
  })

  it('still reads the root document itself, which the caller named explicitly', async () => {
    // Confinement applies to what a `$ref` reaches, not to the file you asked for.
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ a: { $ref: '#/b' }, b: { value: 1 } }))

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'), { localRefs: false })

    expect(errors).toEqual([])
    expect(resolved).toMatchObject({ a: { value: 1 } })
  })

  it('refuses a local $ref reached through a symlink pointing out of the root', async () => {
    const sub = join(dir, 'sub')
    mkdirSync(sub)
    writeFileSync(join(dir, 'secret.json'), JSON.stringify({ apiKey: 'SUPER-SECRET-VALUE' }))
    writeFileSync(join(sub, 'spec.json'), JSON.stringify({ leak: { $ref: './link.json' } }))
    symlinkSync(join(dir, 'secret.json'), join(sub, 'link.json'))

    const { resolved, errors } = await resolveRefsFromFile(join(sub, 'spec.json'))

    expect(resolved).toEqual({ leak: { $ref: './link.json' } })
    expect(JSON.stringify(resolved)).not.toContain('SUPER-SECRET-VALUE')
    expect(errors[0]?.message).toMatch(/Refusing to read local \$ref/)
  })

  it('does not serve a credentialed remote document to a caller without those credentials', async () => {
    // The multi-tenant leak: caller A fetches with a token, caller B must not be
    // handed A's private document from the process-wide cache.
    const url = 'https://reg.example.com/s.json'
    const fetchA = vi
      .fn<(u: string, i: object) => Promise<Response>>()
      .mockResolvedValue(new Response(JSON.stringify({ Private: { tenant: 'A' } }), { status: 200 }))
    const fetchB = vi
      .fn<(u: string, i: object) => Promise<Response>>()
      .mockResolvedValue(new Response(JSON.stringify({ Private: { tenant: 'B' } }), { status: 200 }))
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: `${url}#/Private` } }))

    const a = await resolveRefsFromFile(join(dir, 'api.json'), {
      allowedHosts: ['reg.example.com'],
      fetch: fetchA,
      headers: { authorization: 'Bearer TENANT-A' },
    })
    const b = await resolveRefsFromFile(join(dir, 'api.json'), {
      allowedHosts: ['reg.example.com'],
      fetch: fetchB,
    })

    expect(a.resolved).toMatchObject({ x: { tenant: 'A' } })
    expect(b.resolved).toMatchObject({ x: { tenant: 'B' } })
    // B's own fetch was used — it did not inherit A's document or A's transport.
    expect(fetchB).toHaveBeenCalledTimes(1)
  })

  it('does not coalesce concurrent loads that carry different credentials', async () => {
    const url = 'https://reg.example.com/s.json'
    const fetchFor = (tenant: string) =>
      vi
        .fn<(u: string, i: object) => Promise<Response>>()
        .mockResolvedValue(new Response(JSON.stringify({ Private: { tenant } }), { status: 200 }))
    const fetchA = fetchFor('A')
    const fetchB = fetchFor('B')
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: `${url}#/Private` } }))

    const [a, b] = await Promise.all([
      resolveRefsFromFile(join(dir, 'api.json'), {
        allowedHosts: ['reg.example.com'],
        fetch: fetchA,
        headers: { authorization: 'Bearer TENANT-A' },
      }),
      resolveRefsFromFile(join(dir, 'api.json'), {
        allowedHosts: ['reg.example.com'],
        fetch: fetchB,
        headers: { authorization: 'Bearer TENANT-B' },
      }),
    ])

    expect(a.resolved).toMatchObject({ x: { tenant: 'A' } })
    expect(b.resolved).toMatchObject({ x: { tenant: 'B' } })
    expect(fetchA).toHaveBeenCalledTimes(1)
    expect(fetchB).toHaveBeenCalledTimes(1)
  })

  it('serves the session cache to a repeat caller with identical credentials', async () => {
    // The credential-aware key must not defeat caching for the ordinary case.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ Foo: { type: 'string' } }), { status: 200 }))
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: 'https://api.example.com/s.json#/Foo' } }))
    const opts = { allowedHosts: ['api.example.com'], headers: { authorization: 'Bearer same' } }

    await resolveRefsFromFile(join(dir, 'api.json'), opts)
    await resolveRefsFromFile(join(dir, 'api.json'), { ...opts, headers: { Authorization: 'Bearer same' } })

    // Header names are case-insensitive, so both calls share the one entry.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('drops a single URL from the session cache', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ Foo: { type: 'string' } }), { status: 200 }))
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: 'https://api.example.com/s.json#/Foo' } }))
    const opts = { allowedHosts: ['api.example.com'] }

    await resolveRefsFromFile(join(dir, 'api.json'), opts)
    clearRemoteCache('https://api.example.com/s.json')
    await resolveRefsFromFile(join(dir, 'api.json'), opts)

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('caps how many documents a single resolve loads', async () => {
    // Each file refs the next, so the fan-out is only bounded by the cap.
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(dir, `d${i}.json`), JSON.stringify({ next: { $ref: `./d${i + 1}.json` }, i }))
    }
    writeFileSync(join(dir, 'd6.json'), JSON.stringify({ i: 6 }))

    const { errors } = await resolveRefsFromFile(join(dir, 'd0.json'), { maxDocuments: 3 })

    expect(errors.some((e) => /Refusing to load more than 3 documents/.test(e.message))).toBe(true)
  })

  it('stops loading documents once the aggregate deadline has elapsed', async () => {
    writeFileSync(join(dir, 'pet.json'), JSON.stringify({ Pet: { type: 'object' } }))
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ pet: { $ref: './pet.json#/Pet' } }))

    // A budget already spent by the time the first ref is reached.
    const { errors } = await resolveRefsFromFile(join(dir, 'api.json'), { totalTimeoutMs: 0 })

    expect(errors.some((e) => /Resolve deadline of 0ms elapsed/.test(e.message))).toBe(true)
  })

  it('records an error instead of throwing on a pathologically nested document', async () => {
    // Deep enough to blow the call stack before the depth cap existed.
    const depth = 20_000
    writeFileSync(join(dir, 'api.json'), '{"a":'.repeat(depth) + '1' + '}'.repeat(depth))

    const { errors } = await resolveRefsFromFile(join(dir, 'api.json'))

    expect(errors.filter((e) => /exceeds the maximum depth/.test(e.message))).toHaveLength(1)
  })

  it('matches allowedHosts case-insensitively and on any port by default', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ Foo: { type: 'string' } }), { status: 200 })),
      )
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({
        a: { $ref: 'https://EXAMPLE.com/s.json#/Foo' },
        b: { $ref: 'https://example.com:8443/s.json#/Foo' },
      }),
    )

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'), {
      allowedHosts: ['EXAMPLE.com'],
    })

    expect(errors).toEqual([])
    expect(resolved).toMatchObject({ a: { type: 'string' }, b: { type: 'string' } })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('honors a port on an allowedHosts entry, including the protocol default', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ Foo: { type: 'string' } }), { status: 200 }),
    )
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({
        ok: { $ref: 'https://example.com/s.json#/Foo' },
        bad: { $ref: 'https://example.com:8443/s.json#/Foo' },
      }),
    )

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'), {
      allowedHosts: ['example.com:443'],
    })

    // The URL omits the port, which counts as the https default of 443…
    expect(resolved).toMatchObject({ ok: { type: 'string' } })
    // …while a different port on the same host is not covered by that entry.
    expect((resolved as { bad: unknown }).bad).toEqual({ $ref: 'https://example.com:8443/s.json#/Foo' })
    expect(errors[0]?.message).toMatch(/host is not in the allow-list/)
  })

  it('refuses a cloud-metadata host reached by name', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({ x: { $ref: 'http://metadata.google.internal/computeMetadata/v1/#/token' } }),
    )

    const { errors } = await resolveRefsFromFile(join(dir, 'api.json'))

    expect(errors[0]?.message).toMatch(/Refusing to resolve remote \$ref/)
    expect(fetchSpy).not.toHaveBeenCalled()
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

  it('does not serve a permissively-fetched document to a stricter later call', async () => {
    // `assertPublicHost` runs at fetch time only, so leaving the host guards out
    // of the cache scope meant a call made with `allowPrivateHosts` warmed the
    // cache for a URL a default-options call would have refused — and the later
    // call, hitting the cache, never reached the guard.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ type: 'string' }), { status: 200 }))
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ a: { $ref: 'https://svc.internal/s.json' } }))

    const warm = await resolveRefsFromFile(join(dir, 'api.json'), { allowPrivateHosts: true })
    expect(warm.resolved).toMatchObject({ a: { type: 'string' } })

    const strict = await resolveRefsFromFile(join(dir, 'api.json'))
    expect(strict.errors[0]?.message).toMatch(/Refusing to resolve remote/)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('reports a fragment that does not resolve inside a document that loaded', async () => {
    // This inlined literal `undefined`, so the key vanished on serialization and
    // a required property silently lost every constraint it had — with nothing
    // on `errors` to say so.
    writeFileSync(
      join(dir, 'root.json'),
      JSON.stringify({
        properties: { a: { $ref: '#/$defs/typo' }, b: { $ref: '#/$defs/real' } },
        $defs: { real: { type: 'string' } },
      }),
    )

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'root.json'))

    expect(errors[0]?.message).toMatch(/Cannot resolve \$ref "#\/\$defs\/typo"/)
    // The node is kept rather than dropped, matching `resolveRefs`.
    expect(resolved).toMatchObject({ properties: { a: { $ref: '#/$defs/typo' }, b: { type: 'string' } } })
  })

  it('does not double-report a fragment whose document failed to load', async () => {
    writeFileSync(join(dir, 'root.json'), JSON.stringify({ a: { $ref: './missing.json#/$defs/x' } }))

    const { errors } = await resolveRefsFromFile(join(dir, 'root.json'))

    expect(errors.filter((error) => /Cannot resolve/.test(error.message))).toEqual([])
    expect(errors).toHaveLength(1)
  })

  it('hoists a cross-file cycle without overwriting an existing root $defs entry', async () => {
    // `hoistName` derives the name from the ref's file basename, so `b.json`
    // collided with a root definition already called `b` — and the hoist then
    // overwrote it, silently re-pointing every kept `#/$defs/b` cycle ref at the
    // wrong schema.
    writeFileSync(
      join(dir, 'b.json'),
      JSON.stringify({ $defs: { Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } } } }),
    )
    writeFileSync(
      join(dir, 'root.json'),
      JSON.stringify({
        $defs: { b: { type: 'string', title: 'the root one' } },
        q: { $ref: './b.json#/$defs/Node' },
      }),
    )

    const { resolved } = await resolveRefsFromFile(join(dir, 'root.json'))
    const defs = (resolved as { $defs: Record<string, { title?: string }> }).$defs

    expect(defs['b']).toMatchObject({ type: 'string', title: 'the root one' })
    expect(Object.keys(defs).length).toBeGreaterThan(1)
  })

  it('does not alias the session cache in its result', async () => {
    // Value-position subtrees were handed back by reference, and for a remote
    // document that lives in the process-wide cache — so a caller mutating its
    // own result corrupted every later resolve in the process.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ properties: { k: { enum: ['a', 'b'] } } }), { status: 200 }),
    )
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: 'https://example.com/s.json' } }))

    const first = await resolveRefsFromFile(join(dir, 'api.json'))
    ;(first.resolved as { x: { properties: { k: { enum: string[] } } } }).x.properties.k.enum.push('INJECTED')

    const second = await resolveRefsFromFile(join(dir, 'api.json'))

    expect(second.resolved).toMatchObject({ x: { properties: { k: { enum: ['a', 'b'] } } } })
  })

  it('gives each ref to the same missing target its own kept node', async () => {
    // Caching the kept node as an ordinary resolved value handed the second ref
    // the first one's node, siblings and all.
    writeFileSync(
      join(dir, 'root.json'),
      JSON.stringify({
        $defs: { real: { type: 'string' } },
        first: { $ref: '#/nope', type: 'string' },
        second: { $ref: '#/nope', minLength: 2, properties: { b: { $ref: '#/$defs/real' } } },
      }),
    )

    const { resolved } = await resolveRefsFromFile(join(dir, 'root.json'))
    const doc = resolved as { first: Record<string, unknown>; second: Record<string, unknown> }

    expect(doc.second['type']).toBeUndefined()
    expect(doc.first).not.toBe(doc.second)
    // Siblings still resolve, the way every other kept-node branch behaves.
    expect(doc.second['properties']).toStrictEqual({ b: { type: 'string' } })
  })

  it('copies a subtree handed back past maxDepth', async () => {
    // `detach` was bounded by `maxDepth`, which is precisely the condition this
    // call site guarantees — so the copy never happened and the result aliased
    // the process-wide cache.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ deep: { deeper: { leaf: 'ORIGINAL' } } }), { status: 200 }),
    )
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ x: { $ref: 'https://example.com/s.json' } }))

    const first = await resolveRefsFromFile(join(dir, 'api.json'), { maxDepth: 2 })
    ;(first.resolved as { x: { deep: { deeper: { leaf: string } } } }).x.deep.deeper.leaf = 'INJECTED'

    const second = await resolveRefsFromFile(join(dir, 'api.json'), { maxDepth: 2 })

    expect(second.resolved).toMatchObject({ x: { deep: { deeper: { leaf: 'ORIGINAL' } } } })
  })

  it('does not report a fragment whose document a budget stopped it reaching', async () => {
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ $defs: { Y: { type: 'string' } } }))
    writeFileSync(join(dir, 'c.json'), JSON.stringify({ $defs: { Y: { type: 'number' } } }))
    writeFileSync(
      join(dir, 'root.json'),
      JSON.stringify({ a: { $ref: './b.json#/$defs/Y' }, b: { $ref: './c.json#/$defs/Y' } }),
    )

    const { errors } = await resolveRefsFromFile(join(dir, 'root.json'), { maxDocuments: 2 })

    expect(errors.filter((error) => /Cannot resolve/.test(error.message))).toEqual([])
    expect(errors[0]?.message).toMatch(/Refusing to load more than 2 documents/)
  })

  it('keeps a node whose document a budget stopped it reaching', async () => {
    // Gating the *keep* on the same condition as the error meant a
    // budget-truncated resolve inlined `undefined`, so the referencing node
    // vanished on serialization — trading a duplicate error for silent loss of
    // every constraint on it.
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ $defs: { Y: { type: 'string' } } }))
    writeFileSync(join(dir, 'c.json'), JSON.stringify({ $defs: { Y: { type: 'number' } } }))
    writeFileSync(
      join(dir, 'root.json'),
      JSON.stringify({ properties: { a: { $ref: './b.json#/$defs/Y' }, b: { $ref: './c.json#/$defs/Y' } } }),
    )

    const { resolved } = await resolveRefsFromFile(join(dir, 'root.json'), { maxDocuments: 2 })

    expect(resolved).toMatchObject({
      properties: { a: { type: 'string' }, b: { $ref: './c.json#/$defs/Y' } },
    })
  })

  it('preserves key order when copying a value-position subtree', async () => {
    // The copy walks an explicit LIFO stack, so keys have to be pushed in
    // reverse or the copy comes out with its object keys reversed at every
    // level.
    writeFileSync(
      join(dir, 'root.json'),
      JSON.stringify({ type: 'object', default: { alpha: 1, beta: 2, gamma: { z: 1, y: 2 } } }),
    )

    const { resolved } = await resolveRefsFromFile(join(dir, 'root.json'))
    const value = (resolved as { default: Record<string, unknown> }).default

    expect(Object.keys(value)).toStrictEqual(['alpha', 'beta', 'gamma'])
    expect(Object.keys(value['gamma'] as object)).toStrictEqual(['z', 'y'])
  })

  it('terminates on a cyclic document from a custom parse', async () => {
    // A recursive YAML anchor produces exactly this. The recursive copy was
    // bounded by maxDepth; the iterative one needs its own cycle guard.
    writeFileSync(join(dir, 'root.json'), '{}')
    const cyclic: Record<string, unknown> = { name: 'n' }
    cyclic['child'] = cyclic

    const { resolved } = await resolveRefsFromFile(join(dir, 'root.json'), {
      parse: () => ({ type: 'object', default: cyclic }),
    })
    const value = (resolved as { default: Record<string, unknown> }).default

    // Copied, not aliased — but still a cycle, as it was in the source.
    expect(value).not.toBe(cyclic)
    expect(value['child']).toBe(value)
  })

  it('does not let a hoisted cycle target overwrite a definition the output root already had', async () => {
    // The root is a bare `$ref`, so the resolved output *is* b.json — and the
    // hoist names are picked against the source root's `$defs`, which is not
    // the map being written to. b.json already has a `Node`, and the hoist
    // derived from `c.json#/$defs/Node` wants that same name.
    //
    // The `description` matters: an annotation-only sibling is the one path
    // that copies the kept cycle node instead of placing it, so it is where a
    // rename that only fixed the original would strand this ref on b.json's
    // own `Node` — a definition that exists, resolves, and is the wrong one.
    writeFileSync(join(dir, 'root.json'), JSON.stringify({ $ref: './b.json' }))
    writeFileSync(
      join(dir, 'b.json'),
      JSON.stringify({
        $defs: { Node: { const: 'B_OWN_NODE' } },
        properties: { loop: { $ref: './c.json#/$defs/Node', description: 'd' } },
      }),
    )
    writeFileSync(join(dir, 'c.json'), JSON.stringify({ $defs: { Node: { $ref: './c.json#/$defs/Node' } } }))

    const { resolved } = await resolveRefsFromFile(join(dir, 'root.json'))
    const defs = (resolved as { $defs: Record<string, unknown> }).$defs
    const loop = (resolved as { properties: { loop: Record<string, unknown> } }).properties.loop

    // b.json's own definition survives, and the hoist took a free name.
    expect(defs['Node']).toEqual({ const: 'B_OWN_NODE' })
    const hoisted = Object.keys(defs).find((key) => key !== 'Node')
    expect(hoisted).toBeDefined()
    // Every kept cycle ref names the hoist's *final* name, including the one
    // on the copied node.
    expect(loop['$ref']).toBe(`#/$defs/${hoisted}`)
    expect(loop['description']).toBe('d')
    const refs = [...JSON.stringify(resolved).matchAll(/"\$ref":"([^"]+)"/g)].map((match) => match[1])
    expect(new Set(refs)).toEqual(new Set([`#/$defs/${hoisted}`]))
  })

  it('rebases a kept relative ref so it still names the document it was written against', async () => {
    // `sub/b.json` refers to its own sibling `c.json`. The fragment is a typo,
    // so the ref is kept — and the output is read relative to the *root*, where
    // a different `c.json` sits. Re-emitting the ref verbatim silently bound it
    // to that other file, which resolves cleanly and is simply the wrong answer.
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'root.json'), JSON.stringify({ a: { $ref: './sub/b.json' } }))
    writeFileSync(join(dir, 'sub', 'b.json'), JSON.stringify({ x: { $ref: './c.json#/$defs/typo' } }))
    writeFileSync(join(dir, 'sub', 'c.json'), JSON.stringify({ $defs: { real: { const: 'SUB_C' } } }))
    writeFileSync(join(dir, 'c.json'), JSON.stringify({ $defs: { typo: { const: 'ROOT_C_WRONG' } } }))

    const { resolved } = await resolveRefsFromFile(join(dir, 'root.json'))

    expect(resolved).toEqual({ a: { x: { $ref: './sub/c.json#/$defs/typo' } } })
  })

  it('keeps a node whose document was refused rather than inlining undefined', async () => {
    // Inside an array `undefined` serializes to `null`, so an `allOf` branch
    // pointing at a refused document produced `allOf: [null]` — not a schema.
    writeFileSync(
      join(dir, 'root.json'),
      JSON.stringify({ type: 'object', allOf: [{ $ref: '../outside.json#/$defs/X' }] }),
    )

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'root.json'))

    expect(resolved).toEqual({ type: 'object', allOf: [{ $ref: '../outside.json#/$defs/X' }] })
    expect(JSON.parse(JSON.stringify(resolved))).toEqual(resolved)
    // The loader already said why; the keep must not add a second, vaguer one.
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/Refusing to read local \$ref/)
  })

  it('preserves a class instance a custom parse put in value position', async () => {
    // js-yaml yields a `Date` for a YAML timestamp. Copying value-position
    // subtrees as plain objects emptied it — `default: 2020-01-01` became
    // `default: {}` — with nothing to say the constraint had been dropped.
    writeFileSync(join(dir, 'root.json'), 'parsed by the callback')
    const stamp = new Date('2020-01-01T00:00:00.000Z')

    const { resolved } = await resolveRefsFromFile(join(dir, 'root.json'), {
      parse: () => ({ type: 'string', default: stamp }),
    })
    const value = (resolved as { default: Date }).default

    expect(value).toBeInstanceOf(Date)
    expect(value.getTime()).toBe(stamp.getTime())
    // Copied, not aliased — the session cache must stay unreachable from the
    // caller's result, which is why value positions are detached at all.
    expect(value).not.toBe(stamp)
  })

  it('keeps a fragment-less ref into a document that never loaded', async () => {
    // A document that was refused sits in the cache as a `{}` placeholder, so a
    // ref with no fragment *does* resolve — to an empty schema, which accepts
    // anything. That turns a refused constraint into a hole rather than an
    // error, which is worse than the `undefined` the fragment case stopped
    // inlining.
    writeFileSync(join(dir, 'root.json'), JSON.stringify({ type: 'object', allOf: [{ $ref: '../outside.json' }] }))

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'root.json'))

    expect(resolved).toEqual({ type: 'object', allOf: [{ $ref: '../outside.json' }] })
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/Refusing to read local \$ref/)
  })

  it('keeps a fragment-less ref to a host the SSRF guard refused', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    writeFileSync(join(dir, 'root.json'), JSON.stringify({ x: { $ref: 'http://169.254.169.254/meta' } }))

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'root.json'))

    expect(resolved).toEqual({ x: { $ref: 'http://169.254.169.254/meta' } })
    expect(errors[0]?.message).toMatch(/Refusing to resolve remote \$ref/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('leaves a kept ref with a non-http scheme alone instead of rebasing it', async () => {
    // `urn:example:common` names the same thing from any document, so there is
    // nothing to rebase — and treating it as a relative path produced the
    // nonsense `./sub/urn:example:common`.
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'root.json'), JSON.stringify({ a: { $ref: './sub/b.json' } }))
    writeFileSync(join(dir, 'sub', 'b.json'), JSON.stringify({ x: { $ref: 'urn:example:common#/$defs/Q' } }))

    const { resolved } = await resolveRefsFromFile(join(dir, 'root.json'))

    expect(resolved).toEqual({ a: { x: { $ref: 'urn:example:common#/$defs/Q' } } })
  })

  it('rebases the refs inside a subtree the depth limit handed back whole', async () => {
    // Past `maxDepth` the subtree is returned as-is rather than unwinding the
    // stack — but it is still being lifted into a root-based output, so its
    // relative refs need the same rebasing a resolved one gets. Left verbatim,
    // `./c.json` came to name the root's own c.json: a different file that
    // exists and resolves cleanly.
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'root.json'), JSON.stringify({ a: { $ref: './sub/b.json' } }))
    writeFileSync(
      join(dir, 'sub', 'b.json'),
      JSON.stringify({ d1: { d2: { d3: { x: { $ref: './c.json#/$defs/real' } } } } }),
    )
    writeFileSync(join(dir, 'sub', 'c.json'), JSON.stringify({ $defs: { real: { const: 'SUB_C' } } }))
    writeFileSync(join(dir, 'c.json'), JSON.stringify({ $defs: { real: { const: 'ROOT_C_WRONG' } } }))

    const { resolved } = await resolveRefsFromFile(join(dir, 'root.json'), { maxDepth: 4 })

    expect(JSON.stringify(resolved)).toContain('./sub/c.json#/$defs/real')
    expect(JSON.stringify(resolved)).not.toContain('"./c.json#/$defs/real"')
  })
})
