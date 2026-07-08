import { describe, expect, it } from 'vitest'

import { lint } from '../../core'
import { allFunctions, createOpenApiRuleset, oas, oasFixers, oasFormats, oasFunctions } from './index'

// A minimal OpenAPI 3.0 document with obvious, resolution-free violations: the
// info object has no contact/description, and the single operation has no
// description or tags. Enough to prove the ruleset runs end to end with both the
// built-in functions (truthy) and the OpenAPI-specific ones wired in.
const doc = [
  'openapi: 3.0.0',
  'info:',
  '  title: Test API',
  '  version: 1.0.0',
  'paths:',
  '  /pets:',
  '    get:',
  '      operationId: getPets',
  '      responses:',
  "        '200':",
  '          description: OK',
  '',
].join('\n')

describe('createOpenApiRuleset', () => {
  it('runs the built-in OpenAPI ruleset end to end', async () => {
    const ruleset = createOpenApiRuleset({ extends: [[oas, 'all']] })
    const findings = await lint(doc, { ruleset })
    const codes = new Set(findings.map((finding) => finding.code))
    // A shared rule backed by a built-in function (truthy): the operation has no description.
    expect(codes.has('operation-description')).toBe(true)
    // The info object has neither a contact nor a description.
    expect(codes.has('info-contact')).toBe(true)
    // Every finding carries an exact source range.
    for (const finding of findings) expect(finding.range.start.line).toBeGreaterThanOrEqual(0)
  })

  it('layers the OpenAPI functions over the built-ins', () => {
    // oasTagDefined is OpenAPI-specific; alphabetical is a built-in.
    expect(Object.keys(oasFunctions)).toContain('oasTagDefined')
    expect(allFunctions['oasTagDefined']).toBe(oasFunctions['oasTagDefined'])
    expect(allFunctions['alphabetical']).toBeDefined()

    const ruleset = createOpenApiRuleset()
    expect(ruleset.getFunction('oasTagDefined')).toBeDefined()
    expect(ruleset.getFunction('truthy')).toBeDefined()
  })

  it('resolves the oas / loupe:oas / spectral:oas names to the built-in ruleset', () => {
    for (const name of ['oas', 'loupe:oas', 'spectral:oas']) {
      const ruleset = createOpenApiRuleset({ extends: [name] })
      expect(ruleset.rules.length).toBeGreaterThan(0)
    }
  })

  it('exposes the OpenAPI formats and fixers', () => {
    expect(oasFormats['oas3']?.({ openapi: '3.0.0' })).toBe(true)
    expect(oasFormats['oas2']?.({ swagger: '2.0' })).toBe(true)
    expect(oasFixers['no-$ref-siblings']).toBeDefined()
  })
})
