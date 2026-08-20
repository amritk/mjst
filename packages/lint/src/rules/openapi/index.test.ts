import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('resolves every function the shipped ruleset references (no unknown functions)', () => {
    // The core runner is moving to throw on unknown function names, so the shipped
    // `oas` ruleset must never reference a function that is not registered.
    const ruleset = createOpenApiRuleset({ extends: [[oas, 'all']] })
    for (const rule of ruleset.rules) {
      for (const then of rule.then) {
        if (typeof then.function === 'string') {
          expect(ruleset.getFunction(then.function), `${rule.name} → ${then.function}`).toBeDefined()
        }
      }
    }
  })

  it('survives an extends cycle across two ruleset files', () => {
    // Each file read returns a fresh object, so an object-identity cycle guard
    // never fires on a file cycle: `a.yaml` → `b.yaml` → `a.yaml` recursed until
    // the stack ran out. The guard keys on the resolved (basePath, reference) edge.
    const dir = mkdtempSync(join(tmpdir(), 'oas-cycle-'))
    writeFileSync(join(dir, 'a.yaml'), "extends: ['./b.yaml']\nrules: {}\n")
    writeFileSync(join(dir, 'b.yaml'), "extends: ['./a.yaml']\nrules: {}\n")
    expect(() => createOpenApiRuleset({ extends: ['./a.yaml'] }, dir)).not.toThrow()
  })

  it('confines extends resolution to restrictTo when one is given', () => {
    // The OpenAPI entry point shares the core loader, so it enforces the same
    // optional root; it used to carry its own copy with no fence at all.
    const root = mkdtempSync(join(tmpdir(), 'oas-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'oas-outside-'))
    writeFileSync(join(root, 'ok.yaml'), 'rules: {}\n')
    writeFileSync(join(outside, 'evil.yaml'), 'rules: {}\n')
    expect(() => createOpenApiRuleset({ extends: ['./ok.yaml'] }, root, { restrictTo: root })).not.toThrow()
    expect(() => createOpenApiRuleset({ extends: [join(outside, 'evil.yaml')] }, root, { restrictTo: root })).toThrow(
      /outside the permitted root/,
    )
    // A built-in preset name is not a file, so it is unaffected by the fence.
    expect(() => createOpenApiRuleset({ extends: ['oas'] }, root, { restrictTo: root })).not.toThrow()
  })

  it('every auto-fixer targets a rule that exists in the shipped ruleset', () => {
    const ruleset = createOpenApiRuleset({ extends: [[oas, 'all']] })
    const ruleNames = new Set(ruleset.rules.map((rule) => rule.name))
    for (const code of Object.keys(oasFixers)) {
      expect(ruleNames.has(code), code).toBe(true)
    }
  })
})
