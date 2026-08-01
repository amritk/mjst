// ---------------------------------------------------------------------------
// The grammar of a `[?(...)]` filter body, parsed into a tiny AST.
//
// Ruleset filters used to be handed straight to `new Function`, which made a
// `given` string in a YAML/JSON ruleset — data, as far as any caller can tell —
// arbitrary JavaScript running in the host process. This parser exists so the
// engine can evaluate exactly the expression shapes rulesets need and nothing
// else: no property access on the prototype chain, no calls beyond a fixed list
// of pure string/array/regex methods, no way to reach a global.
//
// The grammar covers what Spectral-style rulesets actually write:
//
//   @  @.name  @['name']  @[0]  @property  @parentProperty  @parent  @path  @root  $
//   ===  !==  ==  !=  <  <=  >  >=  &&  ||  !  (…)  - (numeric negation)
//   'str'  "str"  12  1.5  true  false  null  undefined  void 0  /re/flags
//   .length  .indexOf(x)  .includes(x)  .startsWith(x)  .endsWith(x)
//   .match(/re/)  /re/.test(x)  .toLowerCase()  .toUpperCase()  .trim()
//
// Anything outside it is a parse error carrying an offset, which the JSONPath
// compiler turns into a `CompiledPath.error` and `createRuleset` reports as a
// broken rule. That is deliberate: a filter we cannot evaluate must be loud, not
// a predicate that silently matches nothing.
// ---------------------------------------------------------------------------

/** The `@…` tokens a filter can read from its evaluation context. */
export type ContextRef = 'value' | 'property' | 'parent' | 'parentProperty' | 'path' | 'root'

/** One node of a parsed filter expression. */
export type FilterNode =
  | { kind: 'literal'; value: unknown }
  | { kind: 'regex'; value: RegExp }
  | { kind: 'context'; ref: ContextRef }
  /** `@.name` — a static member read. */
  | { kind: 'member'; object: FilterNode; name: string }
  /** `@['name']` / `@[0]` — a member read through an expression. */
  | { kind: 'computed'; object: FilterNode; index: FilterNode }
  /** `@.indexOf('x')` — a call to one of the allowed pure methods. */
  | { kind: 'call'; object: FilterNode; name: string; args: FilterNode[] }
  | { kind: 'unary'; operator: '!' | '-' | 'void'; operand: FilterNode }
  | { kind: 'comparison'; operator: ComparisonOperator; left: FilterNode; right: FilterNode }
  | { kind: 'logical'; operator: '&&' | '||'; left: FilterNode; right: FilterNode }

export type ComparisonOperator = '===' | '!==' | '==' | '!=' | '<' | '<=' | '>' | '>='

/** A successfully parsed filter, plus whether it reads `@path` (materializing that is not free). */
export type ParsedFilter = { node: FilterNode; usesPath: boolean }

const CONTEXT_TOKENS: Record<string, ContextRef> = {
  '@': 'value',
  '@property': 'property',
  '@parentProperty': 'parentProperty',
  '@parent': 'parent',
  '@path': 'path',
  '@root': 'root',
}

const KEYWORDS: Record<string, unknown> = {
  true: true,
  false: false,
  null: null,
  undefined: undefined,
}

const PUNCTUATORS = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||', '!', '<', '>', '(', ')', '[', ']', '.', ',', '-']

const isNameStart = (ch: string): boolean => /[A-Za-z_$]/.test(ch)
const isNameChar = (ch: string): boolean => /[A-Za-z0-9_$]/.test(ch)
const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9'

type Token =
  | { kind: 'punct'; text: string; start: number }
  | { kind: 'name'; text: string; start: number }
  | { kind: 'context'; ref: ContextRef; start: number }
  | { kind: 'value'; value: unknown; start: number }
  | { kind: 'regex'; value: RegExp; start: number }

/** Thrown while parsing and turned into a message by {@link parseFilterExpression}. */
type FilterSyntaxError = Error & { offset: number }

// The explicit type annotation is what lets TypeScript treat a `fail(...)` call
// as unreachable-after, so the checks below narrow without a cast.
const fail: (message: string, offset: number) => never = (message, offset) => {
  const error = new Error(message) as FilterSyntaxError
  error.offset = offset
  throw error
}

/** Reads a `'…'` / `"…"` literal, honoring the usual backslash escapes. */
const readString = (source: string, start: number): { value: string; end: number } => {
  const quote = source[start] as string
  let out = ''
  let i = start + 1
  while (i < source.length) {
    const ch = source[i] as string
    if (ch === '\\') {
      const next = source[i + 1]
      if (next === undefined) fail('Unterminated string literal', start)
      const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' }
      out += escapes[next] ?? next
      i += 2
      continue
    }
    if (ch === quote) return { value: out, end: i + 1 }
    out += ch
    i++
  }
  return fail('Unterminated string literal', start)
}

/**
 * Reads a `/pattern/flags` literal. Filters have no division operator, so a `/`
 * always starts a regex — which keeps the lexer free of the usual
 * regex-versus-division ambiguity.
 */
const readRegExp = (source: string, start: number): { value: RegExp; end: number } => {
  let i = start + 1
  let inClass = false
  let pattern = ''
  while (i < source.length) {
    const ch = source[i] as string
    if (ch === '\\') {
      pattern += ch + (source[i + 1] ?? '')
      i += 2
      continue
    }
    if (ch === '[') inClass = true
    else if (ch === ']') inClass = false
    else if (ch === '/' && !inClass) break
    pattern += ch
    i++
  }
  if (source[i] !== '/') return fail('Unterminated regular expression literal', start)
  i++
  let flags = ''
  while (i < source.length && isNameChar(source[i] as string)) {
    flags += source[i]
    i++
  }
  try {
    return { value: new RegExp(pattern, flags), end: i }
  } catch (error) {
    return fail(`Invalid regular expression: ${(error as Error).message}`, start)
  }
}

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i] as string
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      const { value, end } = readString(source, i)
      tokens.push({ kind: 'value', value, start: i })
      i = end
      continue
    }
    if (ch === '/') {
      const { value, end } = readRegExp(source, i)
      tokens.push({ kind: 'regex', value, start: i })
      i = end
      continue
    }
    if (ch === '@') {
      let end = i + 1
      while (end < source.length && isNameChar(source[end] as string)) end++
      const text = source.slice(i, end)
      const ref = CONTEXT_TOKENS[text]
      if (ref === undefined) fail(`Unsupported context token "${text}"`, i)
      tokens.push({ kind: 'context', ref, start: i })
      i = end
      continue
    }
    if (ch === '$') {
      // A bare `$` is the document root, the same value `@root` exposes. Anything
      // longer starting with `$` is an identifier (`$ref` after a `.`).
      if (!isNameChar(source[i + 1] ?? '')) {
        tokens.push({ kind: 'context', ref: 'root', start: i })
        i++
        continue
      }
    }
    if (isDigit(ch)) {
      let end = i
      while (end < source.length && /[0-9.eE]/.test(source[end] as string)) {
        // Allow the sign of an exponent (`1e-3`) without swallowing a subtraction.
        if ((source[end] === 'e' || source[end] === 'E') && (source[end + 1] === '-' || source[end + 1] === '+')) end++
        end++
      }
      const text = source.slice(i, end)
      const value = Number(text)
      if (Number.isNaN(value)) fail(`Invalid number "${text}"`, i)
      tokens.push({ kind: 'value', value, start: i })
      i = end
      continue
    }
    if (isNameStart(ch)) {
      let end = i
      while (end < source.length && isNameChar(source[end] as string)) end++
      tokens.push({ kind: 'name', text: source.slice(i, end), start: i })
      i = end
      continue
    }
    const punct = PUNCTUATORS.find((candidate) => source.startsWith(candidate, i))
    if (punct === undefined) fail(`Unexpected character "${ch}"`, i)
    tokens.push({ kind: 'punct', text: punct, start: i })
    i += punct.length
  }
  return tokens
}

/** The pure methods a filter may call. Everything else is a parse error. */
const ALLOWED_METHODS = new Set([
  'indexOf',
  'lastIndexOf',
  'includes',
  'startsWith',
  'endsWith',
  'match',
  'test',
  'toLowerCase',
  'toUpperCase',
  'trim',
])

/**
 * Parses a filter body into a {@link ParsedFilter}, or returns the reason it
 * could not. Precedence follows JavaScript: `||` < `&&` < equality < relational
 * < unary < member/call.
 */
export const parseFilterExpression = (source: string): ParsedFilter | { error: string } => {
  let tokens: Token[]
  try {
    tokens = tokenize(source)
  } catch (error) {
    const syntax = error as FilterSyntaxError
    return { error: `${syntax.message} at offset ${syntax.offset} in filter "${source}"` }
  }

  let position = 0
  let usesPath = false
  const peek = (): Token | undefined => tokens[position]
  const offsetOf = (token: Token | undefined): number => token?.start ?? source.length
  const eatPunct = (text: string): boolean => {
    const token = peek()
    if (token?.kind === 'punct' && token.text === text) {
      position++
      return true
    }
    return false
  }
  const expectPunct = (text: string): void => {
    if (!eatPunct(text)) fail(`Expected "${text}"`, offsetOf(peek()))
  }

  const parseArguments = (): FilterNode[] => {
    const args: FilterNode[] = []
    if (eatPunct(')')) return args
    for (;;) {
      args.push(parseOr())
      if (eatPunct(')')) return args
      expectPunct(',')
    }
  }

  const parsePostfix = (object: FilterNode): FilterNode => {
    let node = object
    for (;;) {
      if (eatPunct('.')) {
        const token = peek()
        if (token?.kind !== 'name') return fail('Expected a property name after "."', offsetOf(token))
        position++
        if (eatPunct('(')) {
          if (!ALLOWED_METHODS.has(token.text)) fail(`Unsupported method "${token.text}()"`, token.start)
          node = { kind: 'call', object: node, name: token.text, args: parseArguments() }
          continue
        }
        node = { kind: 'member', object: node, name: token.text }
        continue
      }
      if (eatPunct('[')) {
        const index = parseOr()
        expectPunct(']')
        node = { kind: 'computed', object: node, index }
        continue
      }
      return node
    }
  }

  const parsePrimary = (): FilterNode => {
    const token = peek()
    if (token === undefined) return fail('Unexpected end of filter expression', source.length)
    if (token.kind === 'value') {
      position++
      return parsePostfix({ kind: 'literal', value: token.value })
    }
    if (token.kind === 'regex') {
      position++
      return parsePostfix({ kind: 'regex', value: token.value })
    }
    if (token.kind === 'context') {
      position++
      if (token.ref === 'path') usesPath = true
      return parsePostfix({ kind: 'context', ref: token.ref })
    }
    if (token.kind === 'name') {
      if (token.text in KEYWORDS) {
        position++
        return parsePostfix({ kind: 'literal', value: KEYWORDS[token.text] })
      }
      return fail(`Unsupported identifier "${token.text}"`, token.start)
    }
    if (token.text === '(') {
      position++
      const inner = parseOr()
      expectPunct(')')
      return parsePostfix(inner)
    }
    return fail(`Unexpected token "${token.text}"`, token.start)
  }

  const parseUnary = (): FilterNode => {
    const token = peek()
    if (token?.kind === 'punct' && (token.text === '!' || token.text === '-')) {
      position++
      return { kind: 'unary', operator: token.text, operand: parseUnary() }
    }
    // `void 0` is how Spectral rulesets spell `undefined` in a filter.
    if (token?.kind === 'name' && token.text === 'void') {
      position++
      return { kind: 'unary', operator: 'void', operand: parseUnary() }
    }
    return parsePrimary()
  }

  const parseRelational = (): FilterNode => {
    let left = parseUnary()
    for (;;) {
      const token = peek()
      if (token?.kind !== 'punct') return left
      if (token.text !== '<' && token.text !== '<=' && token.text !== '>' && token.text !== '>=') return left
      position++
      left = { kind: 'comparison', operator: token.text, left, right: parseUnary() }
    }
  }

  const parseEquality = (): FilterNode => {
    let left = parseRelational()
    for (;;) {
      const token = peek()
      if (token?.kind !== 'punct') return left
      if (token.text !== '===' && token.text !== '!==' && token.text !== '==' && token.text !== '!=') return left
      position++
      left = { kind: 'comparison', operator: token.text, left, right: parseRelational() }
    }
  }

  const parseAnd = (): FilterNode => {
    let left = parseEquality()
    while (eatPunct('&&')) left = { kind: 'logical', operator: '&&', left, right: parseEquality() }
    return left
  }

  // Declared last because it closes the recursion (arguments, parentheses, and
  // computed members all re-enter here); nothing calls it before this point.
  const parseOr = (): FilterNode => {
    let left = parseAnd()
    while (eatPunct('||')) left = { kind: 'logical', operator: '||', left, right: parseAnd() }
    return left
  }

  try {
    if (tokens.length === 0) return { error: `Empty filter expression "${source}"` }
    const node = parseOr()
    const trailing = peek()
    if (trailing !== undefined) fail(`Unexpected token "${'text' in trailing ? trailing.text : ''}"`, trailing.start)
    return { node, usesPath }
  } catch (error) {
    const syntax = error as FilterSyntaxError
    return { error: `${syntax.message} at offset ${syntax.offset} in filter "${source}"` }
  }
}
