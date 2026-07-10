import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { lint, type RulesetDefinition } from '../../core'
import { createOpenApiRuleset } from './index'

// Real-world compatibility guard, modelled on the DigitalOcean API ruleset
// (github.com/digitalocean/openapi/blob/main/.spectral.yml). That ruleset is a
// good stress test because it combines everything a serious Spectral ruleset
// leans on:
//   - `extends: [[spectral:oas, all], <local file>]`
//   - custom functions authored as ESM `export default` and loaded from a
//     `functionsDir`, reading `context.path` (a JsonPath array)
//   - JSONPath features: the `~` key selector, bracket notation (`['schemas']`),
//     `@property` filters using `.match(/regex/)`, and recursive descent
//   - built-in functions `xor` / `truthy` / `pattern` / `schema`
// If any of those regress, this test breaks.
describe('DigitalOcean-style OpenAPI ruleset', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-do-'))
  mkdirSync(join(dir, 'functions'))
  // Authored exactly the way DigitalOcean's custom functions are: an ESM default
  // export with the (input, _opts, context) signature, reading context.path.
  writeFileSync(
    join(dir, 'functions', 'ensureSnakeKey.mjs'),
    [
      'export default (input, _opts, context) => {',
      "  if (typeof input === 'string' && /^[a-z0-9]+(_[a-z0-9]+)*$/.test(input)) return",
      '  return [{ message: context.path.join(".") + " is not snake_case" }]',
      '}',
      '',
    ].join('\n'),
  )

  const ruleset: RulesetDefinition = {
    // Like DO: pull in the entire OpenAPI preset (all rules), then add house rules.
    extends: [['spectral:oas', 'all']],
    formats: ['oas3'],
    functions: ['ensureSnakeKey'],
    rules: {
      // `~` key selector + bracket notation + custom ESM function.
      'schema-key-must-be-snake-cased': {
        description: 'schema keys must be snake_case',
        given: "$.components['schemas'].*~",
        severity: 'error',
        then: { function: 'ensureSnakeKey' },
      },
      // `@property.match(/regex/)` filter to target only parameterized paths.
      'param-paths-need-404': {
        description: 'paths with a path parameter must define a 404',
        given: '$.paths[?(@property.match(/\\{.*\\}/))]..responses',
        severity: 'error',
        then: { field: '404', function: 'truthy' },
      },
      // `xor` built-in: a parameter must have exactly one of example / examples.
      'params-need-example': {
        description: 'parameters must include an example',
        given: '$..parameters.*',
        severity: 'error',
        then: { function: 'xor', functionOptions: { properties: ['example', 'examples'] } },
      },
    },
  }

  const doc = [
    'openapi: "3.0.3"',
    'info: { title: T, version: "1.0.0" }',
    'paths:',
    '  "/things/{id}":',
    '    get:',
    '      responses:',
    '        "200": { description: ok }', // missing 404 -> param-paths-need-404 fires
    '      parameters:',
    '        - { name: id, in: path, required: true, schema: { type: string } }', // no example -> xor fires
    'components:',
    '  schemas:',
    '    BadKey: { type: object }', // not snake_case -> custom fn fires
    '',
  ].join('\n')

  it('builds (extends spectral:oas all + loads the ESM functionsDir custom fn)', () => {
    const built = createOpenApiRuleset(ruleset, dir)
    expect(typeof built.getFunction('ensureSnakeKey')).toBe('function')
    // The whole spectral:oas preset came in alongside the three house rules.
    expect(built.rules.length).toBeGreaterThan(50)
    expect(built.rules.map((r) => r.name)).toContain('operation-operationId-unique')
  })

  it('runs end to end: custom fn, ~ selector, @property.match filter, and xor all fire', async () => {
    const codes = new Set(
      (await lint(doc, { ruleset: createOpenApiRuleset(ruleset, dir), source: 'do.yaml' })).map((f) => f.code),
    )
    expect(codes.has('schema-key-must-be-snake-cased')).toBe(true) // custom ESM fn + `~` + bracket
    expect(codes.has('param-paths-need-404')).toBe(true) // `@property.match(/regex/)` filter
    expect(codes.has('params-need-example')).toBe(true) // `xor` built-in
    // A rule inherited from the extended spectral:oas preset also fires (the
    // operation has no operationId), proving the extend layered in.
    expect(codes.has('operation-operationId')).toBe(true)
  })
})
