import { lineCounter, nodeAtPath, parseDocument } from '@amritk/yaml'
import { describe, expect, it } from 'vitest'

import { lintDocument } from '../index'
import { DiagnosticSeverity, parseJson, parseYaml } from './index'

/**
 * A mapping key built from aliases to collections that hold aliases: each level
 * names the one below it ten times, so rendering the final key naively expands
 * to 10^11 nodes from roughly 600 bytes of source.
 */
const keyAliasBomb = (): string => {
  const lines = ['a0: &a0 [x, x, x, x, x, x, x, x, x, x]']
  for (let level = 1; level < 12; level++) {
    lines.push(
      `a${level}: &a${level} [${Array(10)
        .fill(`*a${level - 1}`)
        .join(', ')}]`,
    )
  }
  lines.push('[*a11, *a11]: boom')
  return `${lines.join('\n')}\n`
}

/** The classic "billion laughs": the aliases sit in values, so only `toJS` explodes. */
const valueAliasBomb = (): string => {
  let source = 'a0: &a0 ["x","x","x","x","x","x","x","x","x","x"]\n'
  for (let i = 1; i <= 10; i++) {
    const previous = Array.from({ length: 10 }, () => `*a${i - 1}`).join(',')
    source += `a${i}: &a${i} [${previous}]\n`
  }
  return `${source}b: *a10\n`
}

/** Where `@amritk/yaml` itself places the node at `path`, converted to lint's zero-based positions. */
const parserPosition = (source: string, path: (string | number)[]): { line: number; character: number } => {
  const node = nodeAtPath(parseDocument(source).contents, path)
  const pos = lineCounter(source).linePos(node?.start ?? -1)
  return { line: pos.line - 1, character: pos.col - 1 }
}

describe('yaml-hardening', () => {
  it('indexes a key-alias bomb without expanding the key', () => {
    // Lint used to render keys with its own copy of the parser's key renderer,
    // minus the work budget, so this document took seconds where the parser
    // itself takes milliseconds.
    const started = performance.now()
    const result = parseYaml(keyAliasBomb())
    expect(performance.now() - started).toBeLessThan(2_000)
    // Projecting the key is still the parser's resource-exhaustion throw, which
    // surfaces as a diagnostic rather than an exception.
    expect(result.data).toBeUndefined()
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.message).toMatch(/resource-exhaustion/)
  })

  it('keys collection and alias keys exactly as the projection does', () => {
    const source = 'base: &k name\n? [a, b]\n: 1\n*k : 2\n~: 3\n'
    const { data, getLocationForJsonPath } = parseYaml<Record<string, number>>(source)
    expect(Object.keys(data)).toEqual(['base', '[ a, b ]', 'name', ''])
    expect(getLocationForJsonPath(['[ a, b ]'])?.range.start).toEqual({ line: 2, character: 2 })
    expect(getLocationForJsonPath(['name'])?.range.start).toEqual({ line: 3, character: 5 })
    expect(getLocationForJsonPath([''])?.range.start).toEqual({ line: 4, character: 3 })
  })

  it('reports a value alias bomb as a diagnostic instead of throwing', () => {
    const result = parseYaml(valueAliasBomb())
    expect(result.data).toBeUndefined()
    expect(result.diagnostics).toEqual([
      {
        code: 'RESOURCE_EXHAUSTION',
        message: expect.stringMatching(/alias expansion/i),
        severity: DiagnosticSeverity.Error,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      },
    ])
  })

  it('reports a bomb in one document of a stream without losing the others', () => {
    const result = parseYaml<unknown[]>(`name: ok\n---\n${valueAliasBomb()}`)
    expect(result.data).toHaveLength(2)
    expect(result.data[0]).toEqual({ name: 'ok' })
    expect(result.data[1]).toBeUndefined()
    expect(result.diagnostics).toHaveLength(1)
    // The finding sits where the failing document begins, not at the top of the file.
    expect(result.diagnostics[0]?.range.start).toEqual({ line: 2, character: 0 })
  })

  it('lints a value alias bomb end to end without throwing', async () => {
    const results = await lintDocument(valueAliasBomb(), {
      ruleset: {
        rules: { 'require-name': { given: '$', severity: 'error', then: { field: 'name', function: 'truthy' } } },
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.code).toBe('parser')
    expect(results[0]?.message).toMatch(/alias expansion/i)
  })

  it('keeps the parser error code on diagnostics', () => {
    const { diagnostics } = parseYaml('a: 1\na: 2\n')
    expect(diagnostics.map((d) => d.code)).toEqual(['DUPLICATE_KEY'])
  })

  it('keeps the parser warning code on diagnostics', () => {
    const { diagnostics } = parseYaml('%FOO bar\n---\na: 1\n')
    expect(diagnostics.map((d) => [d.code, d.severity])).toEqual([['UNKNOWN_DIRECTIVE', DiagnosticSeverity.Warning]])
  })

  it('counts a lone CR as a line break, as YAML does', () => {
    // YAML 1.2 §5.4: `b-break ::= CR LF | CR | LF`. Counting only LF put every
    // finding in a classic-Mac file on line 0.
    const source = 'a: 1\rb:\r  c: 2\r'
    const { getLocationForJsonPath } = parseYaml(source)
    expect(getLocationForJsonPath(['b', 'c'])?.range.start).toEqual({ line: 2, character: 5 })
    expect(getLocationForJsonPath(['b', 'c'])?.range.start).toEqual(parserPosition(source, ['b', 'c']))
  })

  it('counts CR LF as a single line break', () => {
    const source = 'a: 1\r\nb:\r\n  c: 2\r\n'
    const { getLocationForJsonPath } = parseYaml(source)
    expect(getLocationForJsonPath(['b', 'c'])?.range.start).toEqual({ line: 2, character: 5 })
    expect(getLocationForJsonPath(['b', 'c'])?.range.start).toEqual(parserPosition(source, ['b', 'c']))
  })

  it('places a diagnostic in a CR-only document on the parser line', () => {
    const { diagnostics } = parseYaml('a: 1\rb: 2\ra: 3\r')
    expect(diagnostics[0]?.range.start).toEqual({ line: 2, character: 0 })
  })

  it('counts lone CRs the same way in JSON, whose scanner also breaks lines on CR', () => {
    const { getLocationForJsonPath } = parseJson('{\r  "a": {\r\n    "b": 1\r  }\r}')
    expect(getLocationForJsonPath(['a', 'b'])?.range.start).toEqual({ line: 2, character: 9 })
  })
})
