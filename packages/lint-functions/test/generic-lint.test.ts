import { createRuleset, lint, type RulesetDefinition } from '@amritk/lint-core'
import { describe, expect, it } from 'vitest'

import { builtinFunctions } from '../src/index'

// A non-OpenAPI document (a "bane"-style service config) linted through the
// generic engine: no OpenAPI ruleset, no OpenAPI functions, no format detection.
// This is the "any JSON Schema + custom rules" path — structural validity via the
// `schema` function plus ordinary style rules (`casing`, `pattern`) over JSONPath.
describe('generic lint() over a non-OpenAPI config', () => {
  const config = [
    'version: 1',
    'services:',
    '  api:',
    '    image: myapp:1.2.3',
    '    port: 8080',
    '  UserService:',
    '    image: legacy:latest',
    '    port: not-a-number',
    '',
  ].join('\n')

  // A plain JSON Schema describing the config shape.
  const configSchema = {
    type: 'object',
    required: ['version', 'services'],
    properties: {
      version: { type: 'integer' },
      services: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          required: ['image', 'port'],
          properties: {
            image: { type: 'string' },
            port: { type: 'integer' },
          },
        },
      },
    },
  }

  const definition: RulesetDefinition = {
    rules: {
      // Structural validity against an arbitrary JSON Schema.
      'config-schema': {
        given: '$',
        severity: 'error',
        then: { function: 'schema', functionOptions: { schema: configSchema } },
      },
      // Service names must be kebab-case.
      'service-name-kebab': {
        given: '$.services',
        severity: 'warn',
        then: { field: '@key', function: 'casing', functionOptions: { type: 'kebab' } },
      },
      // No image may be pinned to the floating `:latest` tag.
      'no-latest-image': {
        given: '$..image',
        severity: 'warn',
        message: '{{path}} must not use the :latest tag',
        then: { function: 'pattern', functionOptions: { notMatch: ':latest$' } },
      },
    },
  }

  const run = () => {
    // The engine is format-agnostic: build the ruleset with the built-in functions
    // and no format registry, then drive it with the generic async `lint()` — no
    // resolver is passed because the config has no `$ref`s.
    const ruleset = createRuleset(definition, { functions: builtinFunctions })
    return lint(config, { ruleset, source: 'config.yaml' })
  }

  it('validates the config against its JSON Schema and flags the bad field at line:column', async () => {
    const results = await run()
    const schemaFinding = results.find(
      (r) => r.code === 'config-schema' && r.path.join('.') === 'services.UserService.port',
    )
    expect(schemaFinding).toBeDefined()
    // `port: not-a-number` is on the 8th line (0-indexed line 7).
    expect(schemaFinding?.range.start.line).toBe(7)
    expect(schemaFinding?.source).toBe('config.yaml')
  })

  it('applies custom casing and pattern rules over JSONPath', async () => {
    const results = await run()

    const casing = results.filter((r) => r.code === 'service-name-kebab')
    expect(casing).toHaveLength(1)
    expect(casing[0]?.path).toEqual(['services', 'UserService'])
    // The finding lands on the `UserService` service definition (its block value
    // begins on the 7th line — 0-indexed line 6).
    expect(casing[0]?.range.start.line).toBe(6)

    const latest = results.filter((r) => r.code === 'no-latest-image')
    expect(latest).toHaveLength(1)
    expect(latest[0]?.path).toEqual(['services', 'UserService', 'image'])
    expect(latest[0]?.message).toBe('services.UserService.image must not use the :latest tag')
  })

  it('produces no findings for a valid, well-named config', async () => {
    const clean = ['version: 1', 'services:', '  api:', '    image: myapp:1.2.3', '    port: 8080', ''].join('\n')
    const ruleset = createRuleset(definition, { functions: builtinFunctions })
    const results = await lint(clean, { ruleset, source: 'clean.yaml' })
    expect(results).toHaveLength(0)
  })
})
