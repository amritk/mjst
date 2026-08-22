import { describe, expect, it } from 'vitest'
import { formatInlineLiteral, formatLiteral, isJavaScriptLanguage } from '#helpers/format-literal'

describe('format-literal', () => {
  it('quotes strings as JSON by default', () => {
    expect(formatInlineLiteral('main', 'json')).toBe('"main"')
  })

  it('quotes strings as JavaScript for a JavaScript page', () => {
    expect(formatInlineLiteral('main', 'javascript')).toBe("'main'")
  })

  it('recognises the JavaScript family of languages', () => {
    expect(isJavaScriptLanguage('ts')).toBe(true)
    expect(isJavaScriptLanguage('JavaScript')).toBe(true)
    expect(isJavaScriptLanguage('json')).toBe(false)
    expect(isJavaScriptLanguage('yaml')).toBe(false)
  })

  it('leaves identifier keys unquoted in JavaScript and quotes them in JSON', () => {
    const value = { targetKey: 'shell', clientKey: 'curl' }
    expect(formatInlineLiteral(value, 'javascript')).toBe("{ targetKey: 'shell', clientKey: 'curl' }")
    expect(formatInlineLiteral(value, 'json')).toBe('{"targetKey": "shell", "clientKey": "curl"}')
  })

  it('quotes a JavaScript key that is not an identifier', () => {
    expect(formatInlineLiteral({ 'x-scalar-client-id': 'abc' }, 'javascript')).toBe("{ 'x-scalar-client-id': 'abc' }")
  })

  it('escapes quotes and control characters in a JavaScript string', () => {
    expect(formatInlineLiteral("it's\nhere", 'javascript')).toBe("'it\\'s\\nhere'")
  })

  // A raw newline inside a `**Default:**` code span would close the span and
  // let the rest of the line render as markdown.
  it('never emits a raw newline from an inline literal', () => {
    expect(formatInlineLiteral({ css: 'body {\n  color: red;\n}' }, 'json')).not.toContain('\n')
  })

  it('renders null, booleans and numbers bare', () => {
    expect(formatInlineLiteral(null, 'json')).toBe('null')
    expect(formatInlineLiteral(false, 'json')).toBe('false')
    expect(formatInlineLiteral(42, 'json')).toBe('42')
  })

  // `1e400` interpolates as `Infinity`, which no JSON parser accepts.
  it('renders a non-finite number as null rather than Infinity', () => {
    expect(formatInlineLiteral(Number.POSITIVE_INFINITY, 'json')).toBe('null')
    expect(formatInlineLiteral(Number.NaN, 'javascript')).toBe('null')
  })

  it('renders empty containers inline', () => {
    expect(formatLiteral({}, 'json')).toBe('{}')
    expect(formatLiteral([], 'json')).toBe('[]')
  })

  it('pretty-prints nested objects for a code fence', () => {
    expect(formatLiteral({ targets: { typescript: { packageName: '@acme/api' } } }, 'json')).toBe(
      ['{', '  "targets": {', '    "typescript": {', '      "packageName": "@acme/api"', '    }', '  }', '}'].join(
        '\n',
      ),
    )
  })

  it('pretty-prints arrays with one entry per line', () => {
    expect(formatLiteral({ order: ['production', 'sandbox'] }, 'javascript')).toBe(
      ['{', '  order: [', "    'production',", "    'sandbox'", '  ]', '}'].join('\n'),
    )
  })

  // The block form renders every derived code fence, and a key that is not an
  // identifier has to be quoted there too or the sample is a syntax error.
  it('quotes a non-identifier key in the block form as well', () => {
    expect(formatLiteral({ 'content-type': 'json' }, 'javascript')).toBe("{\n  'content-type': 'json'\n}")
    expect(formatLiteral({ 'content-type': 'json' }, 'json')).toBe('{\n  "content-type": "json"\n}')
  })

  it('skips undefined members, which have no JSON spelling', () => {
    expect(formatInlineLiteral({ a: 1, b: undefined }, 'json')).toBe('{"a": 1}')
  })

  // A caller can hand us anything, including a cycle. Truncating beats a stack
  // overflow in the middle of a docs build — and it truncates to `null`, not an
  // ellipsis, because the fence around it claims to be JSON.
  it('truncates a value nested past the depth cap', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    const rendered = formatInlineLiteral(cyclic, 'json')
    expect(rendered).toContain('null')
    expect(() => JSON.parse(rendered) as unknown).not.toThrow()
  })

  // Whatever the cap does, the fence still says `json`.
  it('stays parseable when a deeply nested value is truncated', () => {
    const deep = (levels: number): unknown => (levels === 0 ? 1 : { n: deep(levels - 1) })
    expect(() => JSON.parse(formatLiteral(deep(60), 'json')) as unknown).not.toThrow()
  })

  it('produces JSON that parses back to the original value', () => {
    const value = { name: 'Acme API', retries: { max: 2 }, tags: ['a', 'b'], enabled: true, missing: null }
    expect(JSON.parse(formatLiteral(value, 'json'))).toEqual(value)
    expect(JSON.parse(formatInlineLiteral(value, 'json'))).toEqual(value)
  })

  // Every spelling of the language a `.ts`/`.tsx` docs page uses renders the
  // same way; one missing from the set silently switched a page to JSON.
  it('reads every javascript language id the same way', () => {
    for (const language of ['js', 'javascript', 'jsx', 'ts', 'tsx', 'typescript', 'TypeScript']) {
      expect(formatInlineLiteral({ a: 'b' }, language), language).toBe("{ a: 'b' }")
    }
    expect(formatInlineLiteral({ a: 'b' }, 'json')).toBe('{"a": "b"}')
  })

  // A literal control character inside a `**Default:**` code span breaks out of
  // the span and takes the rest of the line with it; a bare backslash makes the
  // next escape mean something else.
  it('escapes what a single-quoted javascript string cannot hold', () => {
    expect(formatInlineLiteral('a\\b', 'js')).toBe("'a\\\\b'")
    expect(formatInlineLiteral('a\rb', 'js')).toBe("'a\\rb'")
    expect(formatInlineLiteral('a\tb', 'js')).toBe("'a\\tb'")
    expect(formatInlineLiteral('a\nb', 'js')).toBe("'a\\nb'")
  })

  // `2fa: 1` is a syntax error; the key has to be quoted.
  it('quotes a javascript key that cannot be written bare', () => {
    expect(formatInlineLiteral({ '2fa': 1 }, 'js')).toBe("{ '2fa': 1 }")
    expect(formatInlineLiteral({ $ref: 1, _a: 2 }, 'js')).toBe('{ $ref: 1, _a: 2 }')
  })

  // The cap at its edge: a value nested exactly as deep as the limit still
  // serializes, and one level further collapses to `null` rather than to an
  // ellipsis a `json` fence could not parse.
  it('serializes exactly as deep as it says it can', () => {
    const nest = (levels: number): unknown => (levels === 0 ? 'leaf' : { a: nest(levels - 1) })
    expect(formatInlineLiteral(nest(32), 'json')).toContain('"leaf"')
    expect(formatInlineLiteral(nest(33), 'json')).not.toContain('leaf')
    expect(formatInlineLiteral(nest(33), 'json')).toContain('null')
  })
})
