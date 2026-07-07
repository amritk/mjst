import { describe, expect, it } from 'vitest'

import { DiagnosticSeverity, type IDiagnostic } from '../core'
import { codeClimate, getFormatter, githubActions, html, json, junit, sarif, stylish, teamcity, text } from './index'

const results: IDiagnostic[] = [
  {
    code: 'info-contact',
    message: 'Missing contact',
    path: ['info', 'contact'],
    severity: DiagnosticSeverity.Error,
    source: 'api.yaml',
    range: { start: { line: 2, character: 4 }, end: { line: 2, character: 10 } },
  },
]

describe('formatters', () => {
  it('json emits machine-readable output', () => {
    const parsed = JSON.parse(json(results))
    expect(parsed[0].code).toBe('info-contact')
    expect(parsed[0].range.start.line).toBe(2)
  })

  it('stylish reports 1-based line:column and a summary', () => {
    const output = stylish(results)
    expect(output).toContain('3:5')
    expect(output).toContain('info-contact')
    expect(output).toContain('1 errors')
  })

  it('stylish reports success when empty', () => {
    expect(stylish([])).toContain('No problems found')
  })

  it('github-actions emits workflow commands', () => {
    expect(githubActions(results)).toContain('::error file=api.yaml,line=3,col=5::')
  })

  it('junit emits valid-ish xml', () => {
    expect(junit(results)).toContain('<testsuites>')
    expect(junit(results)).toContain('info-contact')
  })

  it('text emits a plain one-line-per-finding format', () => {
    expect(text(results)).toBe('api.yaml:3:5 error Missing contact (info-contact)')
  })

  it('teamcity emits service messages', () => {
    expect(teamcity(results)).toContain("##teamcity[message text='Missing contact (info-contact)'")
  })

  it('code-climate emits issues with fingerprints', () => {
    const parsed = JSON.parse(codeClimate(results))
    expect(parsed[0].check_name).toBe('info-contact')
    expect(parsed[0].severity).toBe('major')
    expect(parsed[0].location.lines.begin).toBe(3)
    expect(typeof parsed[0].fingerprint).toBe('string')
  })

  it('sarif emits a valid 2.1.0 log', () => {
    const parsed = JSON.parse(sarif(results))
    expect(parsed.version).toBe('2.1.0')
    expect(parsed.runs[0].results[0].ruleId).toBe('info-contact')
    expect(parsed.runs[0].results[0].locations[0].physicalLocation.region.startLine).toBe(3)
  })

  it('html emits a table', () => {
    const output = html(results)
    expect(output).toContain('<table')
    expect(output).toContain('info-contact')
  })

  it('exposes all formatters via getFormatter', () => {
    for (const name of ['text', 'teamcity', 'code-climate', 'gitlab', 'sarif', 'html']) {
      expect(typeof getFormatter(name)).toBe('function')
    }
  })

  it('getFormatter throws on unknown name', () => {
    expect(() => getFormatter('nope')).toThrow()
  })
})
