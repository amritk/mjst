import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import Ajv from 'ajv/dist/2020'
import * as fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildExampleSchema } from './build-schema'

/**
 * Two definitions that reference each other across file boundaries (`ping → pong
 * → ping`). The cross-links are *optional* so a concrete value can bottom out,
 * but the reference cycle is real: `ping.ts` and `pong.ts` import each other.
 *
 * Before cross-file cycles were detected, each module emitted an eager top-level
 * reference to the other's arbitrary, and importing either one threw a
 * circular-ESM TDZ `ReferenceError`. The generator now defers those cycle-edge
 * references, so the modules initialize and sample cleanly.
 */
const schema = {
  type: 'object' as const,
  properties: { root: { $ref: '#/$defs/ping' } },
  required: ['root'],
  $defs: {
    ping: {
      type: 'object' as const,
      properties: {
        label: { type: 'string' as const },
        pong: { $ref: '#/$defs/pong' },
      },
      required: ['label'],
    },
    pong: {
      type: 'object' as const,
      properties: {
        count: { type: 'integer' as const },
        ping: { $ref: '#/$defs/ping' },
      },
      required: ['count'],
    },
  },
}

/** The generated module's public shape once written to disk and imported. */
type GeneratedModule = {
  PingArbitrary: fc.Arbitrary<unknown>
  PongArbitrary: fc.Arbitrary<unknown>
}

describe('cross-file mutual recursion', () => {
  let dir: string
  let files: { filename: string; content: string }[]

  beforeAll(async () => {
    files = await buildExampleSchema(schema, 'Doc')
    // Write inside the package so the generated files' bare `import 'fast-check'`
    // resolves through the workspace's hoisted node_modules; a system temp dir
    // has no node_modules ancestor. `import.meta.dirname` is `src/generators`.
    const pkgRoot = join(import.meta.dirname, '..', '..')
    dir = await mkdtemp(join(pkgRoot, '.tmp-mutual-recursion-'))
    await Promise.all(files.map((file) => writeFile(join(dir, file.filename), file.content, 'utf-8')))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const fileContent = (name: string): string => {
    const file = files.find((f) => f.filename === name)
    if (!file) throw new Error(`generated ${name} missing`)
    return file.content
  }

  it('emits lazy references for both cycle edges instead of bare identifiers', () => {
    // `ping.ts` still imports `PongArbitrary`, but reads it lazily; a bare
    // `pong: PongArbitrary` would TDZ-crash the mutually recursive import.
    expect(fileContent('ping.ts')).toContain('import { type Pong, PongArbitrary }')
    expect(fileContent('ping.ts')).toContain('fc.constant(null).chain(() => PongArbitrary)')
    expect(fileContent('ping.ts')).not.toContain('"pong": PongArbitrary')

    expect(fileContent('pong.ts')).toContain('import { type Ping, PingArbitrary }')
    expect(fileContent('pong.ts')).toContain('fc.constant(null).chain(() => PingArbitrary)')
    expect(fileContent('pong.ts')).not.toContain('"ping": PingArbitrary')
  })

  it('imports and samples the generated arbitraries without a TDZ crash', async () => {
    // Importing the barrel initializes every module in the cycle. The eager
    // (pre-fix) output threw a ReferenceError right here.
    const mod = (await import(join(dir, 'index.ts'))) as GeneratedModule

    const validate = new Ajv({ strict: false }).compile({ $ref: '#/$defs/ping', $defs: schema.$defs })

    const pings = fc.sample(mod.PingArbitrary, { numRuns: 20 })
    expect(pings.length).toBe(20)
    for (const value of pings) {
      expect(typeof (value as { label: unknown }).label).toBe('string')
      expect(validate(value), JSON.stringify(validate.errors)).toBe(true)
    }

    const pongs = fc.sample(mod.PongArbitrary, { numRuns: 20 })
    for (const value of pongs) {
      expect(Number.isInteger((value as { count: unknown }).count)).toBe(true)
    }
  })
})
