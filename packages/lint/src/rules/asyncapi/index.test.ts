import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { lint } from '../../core'
import { aasFormats, aasFunctions, allFunctions, asyncapi, createAsyncApiRuleset } from './index'

// A minimal AsyncAPI 2.6 document with obvious, resolution-free violations: the
// info object has no contact, description or license, and the one operation has
// no description. Enough to prove the ruleset runs end to end with both the
// built-in functions (truthy) and the AsyncAPI-specific ones wired in.
const doc = [
  'asyncapi: 2.6.0',
  'info:',
  '  title: Test API',
  '  version: 1.0.0',
  'channels:',
  '  user/signedup:',
  '    subscribe:',
  '      message:',
  '        payload:',
  '          type: object',
  '',
].join('\n')

describe('createAsyncApiRuleset', () => {
  it('runs the built-in AsyncAPI ruleset end to end', async () => {
    const ruleset = createAsyncApiRuleset({ extends: [[asyncapi, 'all']] })
    const findings = await lint(doc, { ruleset })
    const codes = new Set(findings.map((finding) => finding.code))
    // A shared rule backed by a built-in function (truthy): info has no contact.
    expect(codes.has('asyncapi-info-contact')).toBe(true)
    // A 2.x rule backed by a built-in function: the operation has no description.
    expect(codes.has('asyncapi-operation-description')).toBe(true)
    // A 2.x rule backed by an AsyncAPI-specific function.
    expect(codes.has('asyncapi-operation-operationId')).toBe(true)
    // Every finding carries an exact source range.
    for (const finding of findings) expect(finding.range.start.line).toBeGreaterThanOrEqual(0)
  })

  it('lints YAML and JSON to the same findings', async () => {
    const ruleset = createAsyncApiRuleset({ extends: [[asyncapi, 'all']] })
    const json = JSON.stringify({
      asyncapi: '2.6.0',
      info: { title: 'Test API', version: '1.0.0' },
      channels: { 'user/signedup': { subscribe: { message: { payload: { type: 'object' } } } } },
    })
    const fromYaml = (await lint(doc, { ruleset })).map((finding) => finding.code).sort()
    const fromJson = (await lint(json, { ruleset })).map((finding) => finding.code).sort()
    expect(fromJson).toEqual(fromYaml)
  })

  it('layers the AsyncAPI functions over the built-ins', () => {
    // asyncApiChannelParameters is AsyncAPI-specific; alphabetical is a built-in.
    expect(Object.keys(aasFunctions)).toContain('asyncApiChannelParameters')
    expect(allFunctions['asyncApiChannelParameters']).toBe(aasFunctions['asyncApiChannelParameters'])
    expect(allFunctions['alphabetical']).toBeDefined()

    const ruleset = createAsyncApiRuleset()
    expect(ruleset.getFunction('asyncApiChannelParameters')).toBeDefined()
    expect(ruleset.getFunction('truthy')).toBeDefined()
  })

  it('resolves the asyncapi / loupe:asyncapi / spectral:asyncapi names to the built-in ruleset', () => {
    for (const name of ['asyncapi', 'loupe:asyncapi', 'spectral:asyncapi']) {
      const ruleset = createAsyncApiRuleset({ extends: [name] })
      expect(ruleset.rules.length).toBeGreaterThan(0)
    }
  })

  it('exposes the AsyncAPI formats', () => {
    expect(aasFormats['aas2']?.({ asyncapi: '2.6.0' })).toBe(true)
    expect(aasFormats['aas3']?.({ asyncapi: '3.0.0' })).toBe(true)
  })

  it('resolves every function the shipped ruleset references (no unknown functions)', () => {
    const ruleset = createAsyncApiRuleset({ extends: [[asyncapi, 'all']] })
    for (const rule of ruleset.rules) {
      for (const then of rule.then) {
        if (typeof then.function === 'string') {
          expect(ruleset.getFunction(then.function), `${rule.name} → ${then.function}`).toBeDefined()
        }
      }
    }
  })

  it('gates every rule to a format the ruleset declares', () => {
    const declared = new Set(['aas2', 'aas3'])
    const ruleset = createAsyncApiRuleset({ extends: [[asyncapi, 'all']] })
    for (const rule of ruleset.rules) {
      for (const format of rule.formats ?? []) {
        expect(declared.has(format), `${rule.name} → ${format}`).toBe(true)
      }
    }
  })

  it('runs only the recommended rules by default', () => {
    const all = createAsyncApiRuleset({ extends: [[asyncapi, 'all']] }).rules.length
    const recommended = createAsyncApiRuleset().rules.filter((rule) => rule.enabled).length
    expect(recommended).toBeLessThan(all)
    expect(recommended).toBeGreaterThan(0)
  })

  it('survives an extends cycle across two ruleset files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aas-cycle-'))
    writeFileSync(join(dir, 'a.yaml'), "extends: ['./b.yaml']\nrules: {}\n")
    writeFileSync(join(dir, 'b.yaml'), "extends: ['./a.yaml']\nrules: {}\n")
    expect(() => createAsyncApiRuleset({ extends: ['./a.yaml'] }, dir)).not.toThrow()
  })

  it('confines extends resolution to restrictTo when one is given', () => {
    const root = mkdtempSync(join(tmpdir(), 'aas-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'aas-outside-'))
    writeFileSync(join(root, 'ok.yaml'), 'rules: {}\n')
    writeFileSync(join(outside, 'evil.yaml'), 'rules: {}\n')
    expect(() => createAsyncApiRuleset({ extends: ['./ok.yaml'] }, root, { restrictTo: root })).not.toThrow()
    expect(() => createAsyncApiRuleset({ extends: [join(outside, 'evil.yaml')] }, root, { restrictTo: root })).toThrow(
      /outside the permitted root/,
    )
    // A built-in preset name is not a file, so it is unaffected by the fence.
    expect(() => createAsyncApiRuleset({ extends: ['asyncapi'] }, root, { restrictTo: root })).not.toThrow()
  })

  it('lets a house ruleset extend the preset and add its own rules', async () => {
    const ruleset = createAsyncApiRuleset({
      extends: [[asyncapi, 'all']],
      rules: {
        'channel-must-be-scoped': {
          description: 'Channel keys must start with a domain prefix.',
          given: '$.channels',
          severity: 'error',
          then: { field: '@key', function: 'pattern', functionOptions: { match: '^[a-z]+/' } },
        },
      },
    })
    const codes = new Set((await lint(doc, { ruleset })).map((finding) => finding.code))
    expect(codes.has('channel-must-be-scoped')).toBe(false)

    const unscoped = doc.replace('user/signedup', 'signedup')
    const failing = new Set((await lint(unscoped, { ruleset })).map((finding) => finding.code))
    expect(failing.has('channel-must-be-scoped')).toBe(true)
    // The preset's own rules keep running alongside the house rule.
    expect(failing.has('asyncapi-info-contact')).toBe(true)
  })

  it('produces no findings for a document of another spec entirely', async () => {
    const ruleset = createAsyncApiRuleset({ extends: [[asyncapi, 'all']] })
    const openapi = JSON.stringify({ openapi: '3.0.0', info: { title: 'T', version: '1' }, paths: {} })
    expect(await lint(openapi, { ruleset })).toEqual([])
  })
})
