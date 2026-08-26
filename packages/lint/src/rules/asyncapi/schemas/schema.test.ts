import { validate } from '@amritk/runtime-validators'
import { describe, expect, it } from 'vitest'

import {
  ASYNCAPI_VERSIONS,
  type AsyncApiVersion,
  asyncApiSchemaVersion,
  LATEST_ASYNCAPI_VERSION,
  loadAsyncApiSchema,
} from './index'

/**
 * The three upstream patterns this directory rewrites, paired with the
 * replacement `README.md` documents. Every one nests unbounded quantifiers,
 * which `@amritk/runtime-validators` refuses to build a validator from — and the
 * first is genuinely exponential, not merely suspicious.
 */
const ADAPTATIONS = [
  {
    name: 'dotted identifier chain, outer star',
    upstream: '^([A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*)*$',
    vendored: '^(?:[A-Za-z_](?:[A-Za-z0-9_]|\\.[A-Za-z_])*)?$',
  },
  {
    name: 'dotted identifier chain',
    upstream: '^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*$',
    vendored: '^[A-Za-z_](?:[A-Za-z0-9_]|\\.[A-Za-z_])*$',
  },
  {
    name: 'runtime expression pointer',
    upstream: '^\\$message\\.(header|payload)#(\\/(([^\\/~])|(~[01]))*)*',
    vendored: '^\\$message\\.(header|payload)#(?:\\/(?:[^~]|~[01])*)?',
  },
]

/** Collects every `pattern` and `patternProperties` key in a schema tree. */
const collectPatterns = (node: unknown, into: Set<string> = new Set(), depth = 0): Set<string> => {
  if (depth > 100 || node === null || typeof node !== 'object') return into
  if (Array.isArray(node)) {
    for (const item of node) collectPatterns(item, into, depth + 1)
    return into
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'pattern' && typeof value === 'string') into.add(value)
    if (key === 'patternProperties' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const property of Object.keys(value)) into.add(property)
    }
    collectPatterns(value, into, depth + 1)
  }
  return into
}

/** A corpus that exercises the alphabet the three patterns are written over. */
const corpus = (): string[] => {
  const cases = [
    '',
    'a',
    'A_9',
    'a.b',
    'a.b.c',
    'a..b',
    '.a',
    'a.',
    '9a',
    'a-b',
    'a.9',
    '$message.header#',
    '$message.payload#/a/b',
    '$message.payload#/~0/~1',
    '$message.payload#/~2',
    '$message.body#/a',
    'x$message.header#',
  ]
  // Deterministic pseudo-random strings over the characters the patterns care
  // about — no seeded RNG needed, and the same corpus every run.
  const alphabet = [...'aZ_09.-~/$#1']
  let state = 123456789
  const next = (bound: number): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state % bound
  }
  for (let i = 0; i < 20000; i++) {
    const length = 1 + next(14)
    let value = ''
    for (let j = 0; j < length; j++) value += alphabet[next(alphabet.length)]
    cases.push(value, `$message.header#${value}`, `$message.payload#/${value}`)
  }
  return cases
}

describe('AsyncAPI meta-schemas', () => {
  it('bundles one schema per supported version, and every one compiles', () => {
    expect(ASYNCAPI_VERSIONS).toEqual(['2.0', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '3.0'])
    for (const version of ASYNCAPI_VERSIONS) {
      expect(() => validate(loadAsyncApiSchema(version), { formats: 'all' })).not.toThrow()
    }
  })

  it('returns the same object for repeated loads, so validator caches stay warm', () => {
    expect(loadAsyncApiSchema('3.0')).toBe(loadAsyncApiSchema('3.0'))
  })

  it('names the versions it knows when asked for one it does not', () => {
    expect(() => loadAsyncApiSchema('9.9' as AsyncApiVersion)).toThrow(/Unknown AsyncAPI version "9\.9"/)
    // A bare index would have answered this one from `String.prototype`.
    expect(() => loadAsyncApiSchema('toString' as AsyncApiVersion)).toThrow(/Unknown AsyncAPI version/)
  })

  it('accepts a well-formed document and rejects a malformed one, on every version', () => {
    for (const version of ASYNCAPI_VERSIONS) {
      const check = validate(loadAsyncApiSchema(version), { formats: 'all' })
      const declared = `${version}.0`
      const good =
        version === '3.0'
          ? { asyncapi: declared, info: { title: 'T', version: '1' }, channels: { u: { address: 'u' } } }
          : { asyncapi: declared, info: { title: 'T', version: '1' }, channels: {} }
      expect(check(good), version).toBe(true)
      expect(check({ asyncapi: declared, info: { title: 'T' }, channels: 'no' }), version).not.toBe(true)
    }
  })

  // The vendored adaptations -------------------------------------------------
  it('carries no pattern the validator refuses to compile', () => {
    for (const version of ASYNCAPI_VERSIONS) {
      for (const pattern of collectPatterns(loadAsyncApiSchema(version))) {
        expect(() => validate({ type: 'string', pattern }, { formats: 'all' }), `${version}: ${pattern}`).not.toThrow()
      }
    }
  })

  it('has replaced every upstream pattern, in every bundled version', () => {
    for (const version of ASYNCAPI_VERSIONS) {
      const patterns = collectPatterns(loadAsyncApiSchema(version))
      for (const { name, upstream, vendored } of ADAPTATIONS) {
        expect(patterns.has(upstream), `${version}: ${name} still upstream`).toBe(false)
        expect(patterns.has(vendored), `${version}: ${name} missing`).toBe(true)
      }
    }
  })

  it('matches exactly what the upstream pattern matched', () => {
    const cases = corpus()
    for (const { name, upstream, vendored } of ADAPTATIONS) {
      const before = new RegExp(upstream)
      const after = new RegExp(vendored)
      const mismatch = cases.find((value) => before.test(value) !== after.test(value))
      expect(mismatch, `${name} diverges on ${JSON.stringify(mismatch)}`).toBeUndefined()
    }
  })

  // The rewrites predate the ReDoS screen's anchored-repetition exemption,
  // which now admits the two separator-delimited upstream spellings on its
  // own — only the outer-star form (two nested nullable loops) is still
  // refused. The vendored patterns stay: they are equivalent (proved above)
  // and linear without leaning on the exemption.
  it('still needs the outer-star rewrite; the separator-delimited ones are admitted now', () => {
    for (const { name, upstream } of ADAPTATIONS) {
      const build = () => validate({ type: 'string', pattern: upstream }, { formats: 'all' })
      if (name === 'dotted identifier chain, outer star') {
        expect(build, name).toThrow(/Unsafe regular/)
      } else {
        expect(build, name).not.toThrow()
      }
    }
  })

  // Version selection --------------------------------------------------------
  it('maps a declared version to the minor that bundles its schema', () => {
    expect(asyncApiSchemaVersion('2.0.0')).toBe('2.0')
    expect(asyncApiSchemaVersion('3.0.0')).toBe('3.0')
    // Patch releases share their minor's schema, which is how the spec ships them.
    expect(asyncApiSchemaVersion('2.6.4')).toBe('2.6')
    // A minor with no bundled schema is not silently judged against a neighbour.
    expect(asyncApiSchemaVersion('2.7.0')).toBeUndefined()
    expect(asyncApiSchemaVersion('4.0.0')).toBeUndefined()
    // `2.10` must not be read as `2.1`.
    expect(asyncApiSchemaVersion('2.10.0')).toBeUndefined()
    expect(asyncApiSchemaVersion(undefined)).toBeUndefined()
    expect(asyncApiSchemaVersion(3)).toBeUndefined()
  })

  it('names a latest version it actually bundles', () => {
    expect(asyncApiSchemaVersion(LATEST_ASYNCAPI_VERSION)).toBe(ASYNCAPI_VERSIONS[ASYNCAPI_VERSIONS.length - 1])
  })
})
