import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RulesetDefinition, RulesetFunction } from '../core/types'

// Counts the times `@amritk/runtime-validators` is imported. Loading it lazily is
// the whole point of `preloadSchemaValidator`, and an import is the only thing
// that tells a run that skipped it apart from one that paid for it.
let imports = 0

beforeEach(() => {
  imports = 0
  // A fresh module graph per test, so no earlier test has loaded the validator.
  vi.resetModules()
  vi.doMock('@amritk/runtime-validators', async (importOriginal) => {
    imports++
    return importOriginal()
  })
})

/** Builds `definition` with the built-in functions and preloads for it, from a fresh module graph. */
const preloadFor = async (definition: RulesetDefinition): Promise<void> => {
  const { createRuleset } = await import('../index')
  const { preloadSchemaValidator } = await import('./preload-schema-validator')
  await preloadSchemaValidator(createRuleset(definition), undefined)
}

describe('preload-schema-validator', () => {
  it('skips the validator for a ruleset of plain style checks', async () => {
    await preloadFor({
      rules: {
        'require-name': { given: '$', then: { field: 'name', function: 'truthy' } },
        'name-pattern': { given: '$.name', then: { function: 'pattern', functionOptions: { match: '^a' } } },
      },
    })
    expect(imports).toBe(0)
  })

  it('loads the validator for a rule that runs schema', async () => {
    await preloadFor({
      rules: {
        'is-object': { given: '$', then: { function: 'schema', functionOptions: { schema: { type: 'object' } } } },
      },
    })
    expect(imports).toBe(1)
  })

  it('skips the validator when the only schema rule is off', async () => {
    await preloadFor({
      rules: {
        'is-object': {
          given: '$',
          severity: 'off',
          then: { function: 'schema', functionOptions: { schema: { type: 'object' } } },
        },
      },
    })
    expect(imports).toBe(0)
  })

  // A custom function can call the built-in `schema` itself, the way the
  // AsyncAPI preset's functions do, so it has to count as needing the validator.
  it('loads the validator for a rule that runs a custom function', async () => {
    const custom: RulesetFunction = () => []
    await preloadFor({ rules: { custom: { given: '$', then: { function: custom } } } })
    expect(imports).toBe(1)
  })

  it('validates with a schema rule that is the first to need the validator', async () => {
    const { lintDocument } = await import('../index')
    const findings = await lintDocument('name: 1\n', {
      ruleset: {
        rules: {
          'name-is-string': {
            given: '$.name',
            severity: 'error',
            then: { function: 'schema', functionOptions: { schema: { type: 'string' } } },
          },
        },
      },
    })
    expect(imports).toBe(1)
    expect(findings.map((finding) => finding.code)).toEqual(['name-is-string'])
  })

  // Without a lint run to preload it, a direct call still has to work: `schema`
  // is a synchronous public function.
  it('lets schema validate synchronously when nothing preloaded the validator', async () => {
    const { schema } = await import('./schema')
    const results = schema(1, { schema: { type: 'string' } }, { path: ['name'] } as never)
    expect(results).toEqual([{ message: 'value must be string', path: ['name'] }])
  })
})
