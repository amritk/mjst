import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveRefsFromFile } from './resolve-refs-from-file'

/** Freezes a parsed tree all the way down, so any write into it throws (ESM is strict mode). */
const deepFreeze = <T>(node: T): T => {
  if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node)) deepFreeze(value)
    Object.freeze(node)
  }
  return node
}

/** Every object and array reachable from `node` (cycle-safe). */
const objectsIn = (node: unknown, out = new Set<object>()): Set<object> => {
  if (node !== null && typeof node === 'object' && !out.has(node)) {
    out.add(node)
    for (const value of Object.values(node)) objectsIn(value, out)
  }
  return out
}

// `rootDocument` exists so a caller that has already parsed the root (a linter,
// a code generator) does not pay for reading and parsing it a second time.
describe('resolve-refs-from-file', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'resolve-refs-root-document-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('uses rootDocument instead of reading and parsing the root file', async () => {
    writeFileSync(join(dir, 'pet.json'), JSON.stringify({ Pet: { type: 'object' } }))
    // What is on disk no longer matches what the caller parsed; the seeded value wins.
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ stale: true }))
    const parsed: string[] = []

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'), {
      rootDocument: { pet: { $ref: './pet.json#/Pet' } },
      parse: (content, location) => {
        parsed.push(location)
        return JSON.parse(content)
      },
    })

    expect(errors).toEqual([])
    expect(resolved).toEqual({ pet: { type: 'object' } })
    // Only the referenced document went through `parse`.
    expect(parsed).toEqual([join(dir, 'pet.json')])
  })

  it('does not need the root file to exist when rootDocument is given', async () => {
    writeFileSync(join(dir, 'pet.json'), JSON.stringify({ Pet: { type: 'object' } }))

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'missing.json'), {
      rootDocument: { pet: { $ref: './pet.json#/Pet' } },
    })

    expect(errors).toEqual([])
    expect(resolved).toEqual({ pet: { type: 'object' } })
  })

  it('still resolves relative refs and confines them against the root location', async () => {
    const { errors } = await resolveRefsFromFile(join(dir, 'api.json'), {
      rootDocument: { escape: { $ref: '../outside.json' } },
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/Refusing to read local \$ref/)
    expect(errors[0]?.path).toEqual(['escape', '$ref'])
  })

  it('never writes into the seeded root document', async () => {
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ B: { next: { $ref: './api.json#/a' } } }))
    // A cross-file cycle (hoisted into `$defs`), an internal ref, and value
    // positions: every branch that could alias or edit the source tree.
    const rootDocument = deepFreeze({
      $defs: { local: { type: 'string' } },
      a: { $ref: './b.json#/B' },
      s: { $ref: '#/$defs/local' },
      enum: [{ $ref: 'not-a-ref' }],
    })
    const before = structuredClone(rootDocument)

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'), { rootDocument })

    expect(errors).toEqual([])
    expect(rootDocument).toEqual(before)
    // No object of the caller's tree may surface in the result, or a consumer
    // editing its resolved copy would edit the caller's document.
    const sources = objectsIn(rootDocument)
    expect([...objectsIn(resolved)].filter((node) => sources.has(node))).toEqual([])
    expect(resolved).toMatchObject({ s: { type: 'string' }, enum: [{ $ref: 'not-a-ref' }] })
  })

  it('attributes origins to the root location for a seeded root', async () => {
    writeFileSync(join(dir, 'pet.json'), JSON.stringify({ Pet: { type: 'object' } }))
    const root = join(dir, 'api.json')

    const { resolved, origins } = await resolveRefsFromFile(root, {
      rootDocument: { pet: { $ref: './pet.json#/Pet' }, again: { $ref: '#/pet' } },
      trackOrigins: true,
    })

    const { pet } = resolved as { pet: object }
    expect(origins?.get(pet)).toEqual({ location: join(dir, 'pet.json'), pointer: ['Pet'] })
  })

  it('reads the root from disk when rootDocument is undefined', async () => {
    writeFileSync(join(dir, 'api.json'), JSON.stringify({ a: { $ref: '#/b' }, b: 1 }))

    const { resolved, errors } = await resolveRefsFromFile(join(dir, 'api.json'), { rootDocument: undefined })

    expect(errors).toEqual([])
    expect(resolved).toEqual({ a: 1, b: 1 })
  })
})
