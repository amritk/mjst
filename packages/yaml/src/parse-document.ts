import { resolveDoubleQuoted, resolvePlainValue, resolveSingleQuoted } from './resolve-scalar'
import type { ParseOptions, YamlDocument, YamlError, YamlMap, YamlNode, YamlPair, YamlScalar, YamlSeq } from './types'

/**
 * The parser. One cohesive recursive-descent walker — this is the deliberate
 * exception to the repo's one-function-per-file rule (mirroring
 * `runtime-validators`' interpreter): the scanning helpers share a tight,
 * mutable cursor and only make sense together.
 *
 * Strategy: a single left-to-right pass over the source string with an explicit
 * offset cursor (`state.pos`). Block structure is driven by indentation, scalars
 * and flow collections are scanned inline. Every node records its absolute
 * `[start, end)` range as we go, so positions are a byproduct of parsing rather
 * than a second pass. The hot path (plain block mappings of plain scalars)
 * touches each character roughly once.
 */

const NL = 10 // \n
const CR = 13 // \r
const SPACE = 32
const TAB = 9
const HASH = 35 // #
const DASH = 45 // -
const COLON = 58 // :
const STAR = 42 // *
const AMP = 38 // &
const BANG = 33 // !
const SQUOTE = 39 // '
const DQUOTE = 34 // "
const LBRACKET = 91 // [
const RBRACKET = 93 // ]
const LBRACE = 123 // {
const RBRACE = 125 // }
const COMMA = 44 // ,
const PIPE = 124 // |
const GT = 62 // >
const QUESTION = 63 // ?
const DOT = 46 // .
const PERCENT = 37 // %

type LineInfo = {
  eof: boolean
  /** Number of leading spaces on the content line. */
  indent: number
  /** Offset of the first non-space character. */
  contentPos: number
}

type State = {
  src: string
  len: number
  pos: number
  errors: YamlError[]
  warnings: YamlError[]
  anchors: Map<string, YamlNode>
  uniqueKeys: boolean
  merge: boolean
  /**
   * Reused by `peekLine` to avoid allocating a result object per line. Callers
   * read it immediately and never hold it across another `peekLine`, so a single
   * shared instance is safe and keeps large documents allocation-light.
   */
  line: LineInfo
}

type NodeProps = { anchor?: string; tag?: string }

// The common case is a value with no anchor/tag — share one frozen object so
// `scanProps` allocates nothing on the hot path.
const NO_PROPS: NodeProps = Object.freeze({})

const isSpace = (c: number): boolean => c === SPACE || c === TAB

/**
 * True when the character at `after` ends a `?`/`:` introducer — whitespace, a
 * line break, or end of input. This is what distinguishes the explicit-key
 * `? ` / `: ` tokens from an ordinary scalar that merely starts with `?`/`:`.
 */
const introducerBoundary = (src: string, after: number, len: number): boolean => {
  if (after >= len) return true
  const c = src.charCodeAt(after)
  return c === SPACE || c === TAB || c === NL || c === CR
}

/** Offset just past the next line break (or end of input). */
const nextLineStart = (src: string, from: number, len: number): number => {
  let i = from
  while (i < len && src.charCodeAt(i) !== NL) i++
  return i < len ? i + 1 : len
}

/**
 * True when the three characters at `i` are a document marker — `---` or `...` —
 * standing alone (followed by whitespace or end of line). `src.charCodeAt(i)`
 * decides which marker, so a caller that already knows the first char can gate
 * the call and pay nothing on the common path.
 */
const isDocMarker = (src: string, i: number, len: number): boolean => {
  const c = src.charCodeAt(i)
  if ((c !== DASH && c !== DOT) || src.charCodeAt(i + 1) !== c || src.charCodeAt(i + 2) !== c) return false
  const n = src.charCodeAt(i + 3)
  return i + 3 >= len || n === SPACE || n === TAB || n === NL || n === CR
}

/**
 * Advances the cursor to the start of the next line with real content, skipping
 * blank lines and full-line comments. Leaves `state.pos` parked at the start of
 * that line (column 0) so indentation can be measured deterministically.
 */
const peekLine = (state: State): LineInfo => {
  const { src, len, line } = state
  let p = state.pos
  while (p < len) {
    let i = p
    while (i < len && src.charCodeAt(i) === SPACE) i++
    const c = src.charCodeAt(i)
    if (i >= len) break
    if (c === NL || c === CR || c === HASH) {
      p = nextLineStart(src, i, len)
      continue
    }
    state.pos = p
    line.eof = false
    line.indent = i - p
    line.contentPos = i
    return line
  }
  state.pos = len
  line.eof = true
  line.indent = 0
  line.contentPos = len
  return line
}

const skipInlineSpaces = (state: State): void => {
  const { src, len } = state
  let p = state.pos
  while (p < len && isSpace(src.charCodeAt(p))) p++
  state.pos = p
}

/** True when the rest of the current line holds nothing but a comment. */
const atLineEnd = (state: State): boolean => {
  const c = state.src.charCodeAt(state.pos)
  return state.pos >= state.len || c === NL || c === CR || c === HASH
}

/** Consumes a trailing comment and the line break, parking at the next line start. */
const finishLine = (state: State): void => {
  state.pos = nextLineStart(state.src, state.pos, state.len)
}

/**
 * Consumes to the next line only when the cursor is mid-line. Block collections
 * and block scalars already end parked at a line start; scalars, aliases, and
 * flow collections end mid-line and need flushing. The `prev char was \n` test
 * lets one helper serve every node kind.
 */
const finishLineIfMidLine = (state: State): void => {
  if (state.pos > 0 && state.pos < state.len && state.src.charCodeAt(state.pos - 1) !== NL) {
    finishLine(state)
  }
}

const pushError = (state: State, code: string, message: string, start: number, end: number): void => {
  state.errors.push({ kind: 'error', code, message, start, end })
}

/**
 * Finds the offset of the `key:` separator on the current line, or -1 if the
 * line is not a mapping entry. Honors quotes so a `:` inside a quoted key does
 * not count, and requires the YAML block rule that the colon be followed by
 * whitespace or end-of-line.
 */
const findKeyColon = (src: string, from: number, len: number): number => {
  let i = from
  // A quote only delimits when it opens the key (`Let's` mid-word is literal), so
  // the quote-skip belongs before the scan loop — not as a per-character test.
  const first = src.charCodeAt(from)
  if (first === SQUOTE) {
    i = from + 1
    while (i < len) {
      if (src.charCodeAt(i) === SQUOTE) {
        if (src.charCodeAt(i + 1) === SQUOTE) i += 2
        else break
      } else i++
    }
    i++
  } else if (first === DQUOTE) {
    i = from + 1
    while (i < len) {
      const d = src.charCodeAt(i)
      if (d === DQUOTE) break
      if (d === 92 /* \ */) i += 2
      else i++
    }
    i++
  }
  // Past any opening quote, the only things that matter are line end, a ` #`
  // comment, and the `key:` colon. Hoisting the quote checks keeps this the
  // tight inner loop it wants to be — three comparisons per character.
  while (i < len) {
    const c = src.charCodeAt(i)
    if (c === NL || c === CR) return -1
    if (c === HASH && i > from && isSpace(src.charCodeAt(i - 1))) return -1
    if (c === COLON) {
      const n = src.charCodeAt(i + 1)
      if (i + 1 >= len || n === SPACE || n === TAB || n === NL || n === CR) return i
    }
    i++
  }
  return -1
}

/** Reads `&anchor` / `!tag` properties that precede a node value on its line. */
const scanProps = (state: State): NodeProps => {
  const { src } = state
  const c = src.charCodeAt(state.pos)
  // Fast path: the vast majority of values carry no properties.
  if (c !== AMP && c !== BANG && c !== SPACE && c !== TAB) return NO_PROPS
  return scanPropsSlow(state)
}

const scanPropsSlow = (state: State): NodeProps => {
  const { src, len } = state
  let anchor: string | undefined
  let tag: string | undefined
  for (;;) {
    skipInlineSpaces(state)
    const c = src.charCodeAt(state.pos)
    if (c === AMP) {
      let i = state.pos + 1
      while (i < len && !isSpace(src.charCodeAt(i)) && src.charCodeAt(i) !== NL && src.charCodeAt(i) !== CR) i++
      anchor = src.slice(state.pos + 1, i)
      state.pos = i
    } else if (c === BANG) {
      let i = state.pos + 1
      while (i < len && !isSpace(src.charCodeAt(i)) && src.charCodeAt(i) !== NL && src.charCodeAt(i) !== CR) i++
      tag = src.slice(state.pos, i).replace(/^!+/, '')
      state.pos = i
    } else {
      break
    }
  }
  if (anchor === undefined && tag === undefined) return NO_PROPS
  // Build conditionally: `exactOptionalPropertyTypes` forbids explicit undefined.
  const props: NodeProps = {}
  if (anchor !== undefined) props.anchor = anchor
  if (tag !== undefined) props.tag = tag
  return props
}

const attachProps = (node: YamlNode, props: NodeProps, state: State): YamlNode => {
  if (props === NO_PROPS) return node
  if (props.anchor) {
    if (node.kind !== 'alias') node.anchor = props.anchor
    state.anchors.set(props.anchor, node)
  }
  if (props.tag && node.kind !== 'alias') node.tag = props.tag
  return node
}

/** Reads a single- or double-quoted scalar, including multi-line spans. */
const scanQuoted = (state: State, quote: number): YamlScalar => {
  const { src, len } = state
  const start = state.pos
  let i = start + 1
  if (quote === SQUOTE) {
    while (i < len) {
      if (src.charCodeAt(i) === SQUOTE) {
        if (src.charCodeAt(i + 1) === SQUOTE) i += 2
        else {
          i++
          break
        }
      } else i++
    }
  } else {
    while (i < len) {
      const c = src.charCodeAt(i)
      if (c === 92 /* \ */) {
        i += 2
        continue
      }
      if (c === DQUOTE) {
        i++
        break
      }
      i++
    }
  }
  const source = src.slice(start, i)
  const inner = src.slice(start + 1, i - 1)
  const value = quote === SQUOTE ? resolveSingleQuoted(inner) : resolveDoubleQuoted(inner)
  state.pos = i
  return { kind: 'scalar', value, source, style: quote === SQUOTE ? 'single' : 'double', start, end: i }
}

/** Reads a `*alias` reference. */
const scanAlias = (state: State): YamlNode => {
  const { src, len } = state
  const start = state.pos
  let i = start + 1
  while (i < len) {
    const c = src.charCodeAt(i)
    if (isSpace(c) || c === NL || c === CR || c === COMMA || c === RBRACKET || c === RBRACE) break
    i++
  }
  const name = src.slice(start + 1, i)
  state.pos = i
  return { kind: 'alias', source: name, start, end: i }
}

/** Index of the end of a plain scalar's text on one line (trailing spaces and ` #` comment trimmed). */
const plainLineEnd = (src: string, from: number, len: number): number => {
  let i = from
  let lastNonSpace = from
  while (i < len) {
    const c = src.charCodeAt(i)
    if (c === NL || c === CR) break
    if (c === HASH && i > from && isSpace(src.charCodeAt(i - 1))) break
    i++
    if (c !== SPACE && c !== TAB) lastNonSpace = i
  }
  return lastNonSpace
}

/**
 * Reads a plain (unquoted) scalar, folding continuation lines that are indented
 * deeper than `parentIndent`. Single-line plain scalars — the overwhelmingly
 * common case — never allocate the line array.
 */
const scanPlainScalar = (state: State, parentIndent: number): YamlScalar => {
  const { src, len } = state
  const start = state.pos
  let valueEnd = plainLineEnd(src, start, len)

  let segments: string[] | null = null
  let scan = nextLineStart(src, valueEnd, len)
  for (;;) {
    if (scan >= len) break
    let i = scan
    while (i < len && src.charCodeAt(i) === SPACE) i++
    const c = src.charCodeAt(i)
    if (c === NL || c === CR) {
      // Blank line: only meaningful if a deeper line follows, so stage it.
      if (!segments) segments = [src.slice(start, valueEnd)]
      segments.push('')
      scan = nextLineStart(src, i, len)
      continue
    }
    if (i >= len) break
    const indent = i - scan
    if (indent <= parentIndent || c === HASH) break
    // Only a top-level scalar (`parentIndent < 0`) can sit at column 0 alongside
    // a `---`/`...` marker; for nested scalars the indent test above already
    // stopped us, so this short-circuits to a single comparison off the hot path.
    if (parentIndent < 0 && (c === DASH || c === DOT) && isDocMarker(src, i, len)) break
    const lineEnd = plainLineEnd(src, i, len)
    if (!segments) segments = [src.slice(start, valueEnd)]
    segments.push(src.slice(i, lineEnd))
    valueEnd = lineEnd
    scan = nextLineStart(src, lineEnd, len)
  }

  state.pos = valueEnd
  if (!segments) {
    const text = src.slice(start, valueEnd)
    return { kind: 'scalar', value: resolvePlainValue(text), source: text, style: 'plain', start, end: valueEnd }
  }
  // Drop trailing blank segments that turned out to precede sibling structure.
  while (segments.length > 1 && segments[segments.length - 1] === '') segments.pop()
  const folded = foldSegments(segments)
  const source = src.slice(start, valueEnd)
  return { kind: 'scalar', value: folded, source, style: 'plain', start, end: valueEnd }
}

/** Folds plain-scalar continuation lines: single break → space, blank line → newline. */
const foldSegments = (segments: string[]): string => {
  let out = (segments[0] ?? '').replace(/[ \t]+$/, '')
  let i = 1
  while (i < segments.length) {
    const seg = (segments[i] ?? '').trim()
    if (seg === '') {
      let blanks = 0
      while (i < segments.length && (segments[i] ?? '').trim() === '') {
        blanks++
        i++
      }
      out += '\n'.repeat(blanks)
      if (i < segments.length) {
        out += (segments[i] ?? '').trim()
        i++
      }
    } else {
      out += ' ' + seg
      i++
    }
  }
  return out
}

/** Reads a `|` literal or `>` folded block scalar with chomping and indent indicators. */
const scanBlockScalar = (state: State, parentIndent: number): YamlScalar => {
  const { src, len } = state
  const start = state.pos
  const folded = src.charCodeAt(state.pos) === GT
  state.pos++
  let chomp: 'clip' | 'strip' | 'keep' = 'clip'
  let explicitIndent = 0
  for (;;) {
    const c = src.charCodeAt(state.pos)
    if (c === DASH) chomp = 'strip'
    else if (c === 43 /* + */) chomp = 'keep'
    else if (c >= 49 && c <= 57 /* 1-9 */) explicitIndent = c - 48
    else break
    state.pos++
  }
  finishLine(state)

  let contentIndent = explicitIndent ? parentIndent + explicitIndent : -1
  const lines: string[] = []
  let valueEnd = state.pos
  for (;;) {
    const lineStart = state.pos
    if (lineStart >= len) break
    let i = lineStart
    while (i < len && src.charCodeAt(i) === SPACE) i++
    const c = src.charCodeAt(i)
    const indent = i - lineStart
    if (c === NL || c === CR || i >= len) {
      // Whitespace-only line. Once the content indent is known, anything beyond
      // it is real content (literal scalars preserve that extra indentation).
      lines.push(contentIndent !== -1 && indent > contentIndent ? ' '.repeat(indent - contentIndent) : '')
      state.pos = nextLineStart(src, i, len)
      continue
    }
    if (contentIndent === -1) {
      if (indent <= parentIndent) break
      contentIndent = indent
    }
    if (indent < contentIndent) break
    let lineEnd = lineStart + contentIndent
    while (lineEnd < len && src.charCodeAt(lineEnd) !== NL && src.charCodeAt(lineEnd) !== CR) lineEnd++
    lines.push(src.slice(lineStart + contentIndent, lineEnd))
    valueEnd = lineEnd
    state.pos = nextLineStart(src, lineEnd, len)
  }

  // Separate interior content from trailing blank lines for chomping.
  let trailingBlanks = 0
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    trailingBlanks++
    lines.pop()
  }
  const body = folded ? foldSegments(lines) : lines.join('\n')
  let value = body
  if (chomp === 'strip') value = body
  else if (chomp === 'keep') value = body + '\n'.repeat(trailingBlanks + (lines.length ? 1 : 0))
  else value = body + (lines.length ? '\n' : '')

  return {
    kind: 'scalar',
    value,
    source: src.slice(start, valueEnd),
    style: folded ? 'block-folded' : 'block-literal',
    start,
    end: valueEnd,
  }
}

/** Skips whitespace, line breaks, and comments — used between flow tokens. */
const skipFlowWs = (state: State): void => {
  const { src, len } = state
  let p = state.pos
  while (p < len) {
    const c = src.charCodeAt(p)
    if (c === SPACE || c === TAB || c === NL || c === CR) {
      p++
    } else if (c === HASH) {
      p = nextLineStart(src, p, len)
    } else break
  }
  state.pos = p
}

/** Reads a plain scalar inside a flow collection (terminated by flow indicators). */
const scanFlowPlain = (state: State): YamlScalar => {
  const { src, len } = state
  const start = state.pos
  let i = start
  while (i < len) {
    const c = src.charCodeAt(i)
    if (c === COMMA || c === LBRACKET || c === RBRACKET || c === LBRACE || c === RBRACE || c === NL || c === CR) break
    if (c === COLON) {
      const n = src.charCodeAt(i + 1)
      if (i + 1 >= len || isSpace(n) || n === COMMA || n === RBRACKET || n === RBRACE || n === NL || n === CR) break
    }
    if (c === HASH && i > start && isSpace(src.charCodeAt(i - 1))) break
    i++
  }
  let end = i
  while (end > start && isSpace(src.charCodeAt(end - 1))) end--
  const text = src.slice(start, end)
  state.pos = i
  return { kind: 'scalar', value: resolvePlainValue(text), source: text, style: 'plain', start, end }
}

const parseFlowNode = (state: State): YamlNode => {
  skipFlowWs(state)
  const props = scanProps(state)
  skipFlowWs(state)
  const c = state.src.charCodeAt(state.pos)
  let node: YamlNode
  if (c === LBRACKET) node = parseFlowSeq(state)
  else if (c === LBRACE) node = parseFlowMap(state)
  else if (c === DQUOTE || c === SQUOTE) node = scanQuoted(state, c)
  else if (c === STAR) node = scanAlias(state)
  else node = scanFlowPlain(state)
  return attachProps(node, props, state)
}

const parseFlowSeq = (state: State): YamlSeq => {
  const start = state.pos
  state.pos++ // [
  const items: YamlNode[] = []
  for (;;) {
    skipFlowWs(state)
    const c = state.src.charCodeAt(state.pos)
    if (c === RBRACKET) {
      state.pos++
      break
    }
    if (state.pos >= state.len) {
      pushError(state, 'UNTERMINATED_FLOW', 'Missing closing "]" for flow sequence', start, state.pos)
      break
    }
    items.push(parseFlowNode(state))
    skipFlowWs(state)
    const sep = state.src.charCodeAt(state.pos)
    if (sep === COMMA) state.pos++
    else if (sep === RBRACKET) {
      state.pos++
      break
    } else {
      pushError(state, 'UNTERMINATED_FLOW', 'Missing closing "]" for flow sequence', start, state.pos)
      break
    }
  }
  return { kind: 'seq', items, start, end: state.pos }
}

const parseFlowMap = (state: State): YamlMap => {
  const start = state.pos
  state.pos++ // {
  const items: YamlPair[] = []
  for (;;) {
    skipFlowWs(state)
    const c = state.src.charCodeAt(state.pos)
    if (c === RBRACE) {
      state.pos++
      break
    }
    if (state.pos >= state.len) {
      pushError(state, 'UNTERMINATED_FLOW', 'Missing closing "}" for flow mapping', start, state.pos)
      break
    }
    const key = parseFlowNode(state)
    skipFlowWs(state)
    let value: YamlNode | null = null
    if (state.src.charCodeAt(state.pos) === COLON) {
      state.pos++
      skipFlowWs(state)
      const vc = state.src.charCodeAt(state.pos)
      if (vc !== COMMA && vc !== RBRACE) value = parseFlowNode(state)
    }
    items.push({ kind: 'pair', key, value, start: key.start, end: value ? value.end : key.end })
    skipFlowWs(state)
    const sep = state.src.charCodeAt(state.pos)
    if (sep === COMMA) state.pos++
    else if (sep === RBRACE) {
      state.pos++
      break
    } else {
      pushError(state, 'UNTERMINATED_FLOW', 'Missing closing "}" for flow mapping', start, state.pos)
      break
    }
  }
  return { kind: 'map', items, start, end: state.pos }
}

/** Parses the inline value that follows a `key:` separator on the same line. */
const parseInlineValue = (state: State, parentIndent: number): YamlNode | null => {
  const props = scanProps(state)
  skipInlineSpaces(state)
  if (atLineEnd(state)) {
    // Properties with no inline value: the real value is the block node below.
    if (props.anchor || props.tag) {
      finishLine(state)
      const child = peekLine(state)
      if (!child.eof && child.indent > parentIndent) {
        state.pos = child.contentPos
        const node = parseNode(state, child.indent)
        return attachProps(node, props, state)
      }
    }
    return null
  }
  const c = state.src.charCodeAt(state.pos)
  let node: YamlNode
  if (c === STAR) node = scanAlias(state)
  else if (c === PIPE || c === GT) node = scanBlockScalar(state, parentIndent)
  else if (c === LBRACKET) node = parseFlowSeq(state)
  else if (c === LBRACE) node = parseFlowMap(state)
  else if (c === DQUOTE || c === SQUOTE) node = scanQuoted(state, c)
  else node = scanPlainScalar(state, parentIndent)
  return attachProps(node, props, state)
}

/**
 * Parses the node that follows an explicit `?` or `:` introducer: either an
 * inline value on the same line, or a block node on the deeper-indented lines
 * below. Mirrors the implicit `key:` value handling but is reached only on the
 * cold explicit-entry path, so the hot block-mapping loop stays untouched.
 */
const parseValueOrChild = (state: State, indent: number): YamlNode | null => {
  const { src, len } = state
  skipInlineSpaces(state)
  if (atLineEnd(state)) {
    finishLine(state)
    const child = peekLine(state)
    if (!child.eof && child.indent > indent) {
      state.pos = child.contentPos
      return parseNode(state, child.indent)
    }
    if (!child.eof && child.indent === indent) {
      const cc = src.charCodeAt(child.contentPos)
      if (cc === DASH && (child.contentPos + 1 >= len || isSpace(src.charCodeAt(child.contentPos + 1)))) {
        state.pos = child.contentPos
        return parseBlockSeq(state, indent)
      }
    }
    return null
  }
  const node = parseInlineValue(state, indent)
  finishLineIfMidLine(state)
  return node
}

const keyText = (node: YamlNode): string => {
  if (node.kind === 'scalar') {
    const v = node.value
    // Keys are usually strings already — skip the String() round-trip.
    if (typeof v === 'string') return v
    return v === null ? 'null' : String(v)
  }
  if (node.kind === 'alias') return '*' + node.source
  return ''
}

const parseBlockMap = (state: State, indent: number, firstColon: number): YamlMap => {
  const { src, len } = state
  const items: YamlPair[] = []
  // Duplicate-key tracking is lazy: most maps have unique keys, and many have a
  // single key, so we only allocate the Set once a second key actually appears.
  let firstKey: string | null = null
  let seen: Set<string> | null = null

  // The cursor is already parked at the first key's content; later iterations
  // re-derive the next entry's position with `peekLine` (which needs a line
  // start, an invariant the previous entry's value leaves us on).
  let contentPos = state.pos
  let firstEntry = true
  for (;;) {
    let colon: number
    let explicit: boolean
    if (firstEntry) {
      // `parseNode` already classified this line: a non-negative `firstColon` is
      // an inline `key:`; a negative one signals an explicit `?` introducer.
      colon = firstColon
      explicit = firstColon < 0
    } else {
      const line = peekLine(state)
      if (line.eof || line.indent !== indent) break
      contentPos = line.contentPos
      const c = src.charCodeAt(contentPos)
      // A `- ` at this indent is a sequence, not a mapping key.
      if (c === DASH && (contentPos + 1 >= len || isSpace(src.charCodeAt(contentPos + 1)))) break
      colon = findKeyColon(src, contentPos, len)
      if (colon < 0) {
        // No inline colon: either an explicit `? key` entry or the end of the map.
        if (c === QUESTION && introducerBoundary(src, contentPos + 1, len)) explicit = true
        else break
      } else {
        explicit = false
      }
    }
    firstEntry = false

    let key: YamlNode
    let value: YamlNode | null = null
    if (explicit) {
      // `? key` (inline or a block key on the deeper lines below), optionally
      // followed by a `: value` line at the same indent. An absent `: value`
      // line leaves the value null.
      const qStart = contentPos
      state.pos = contentPos + 1
      key = parseValueOrChild(state, indent) ?? {
        kind: 'scalar',
        value: null,
        source: '',
        style: 'plain',
        start: qStart + 1,
        end: qStart + 1,
      }
      const vline = peekLine(state)
      if (
        !vline.eof &&
        vline.indent === indent &&
        src.charCodeAt(vline.contentPos) === COLON &&
        introducerBoundary(src, vline.contentPos + 1, len)
      ) {
        state.pos = vline.contentPos + 1
        value = parseValueOrChild(state, indent)
      }
    } else {
      const lineContentPos = contentPos
      state.pos = contentPos
      const kc = src.charCodeAt(state.pos)
      if (kc === DQUOTE || kc === SQUOTE) {
        key = scanQuoted(state, kc)
      } else {
        let end = colon
        while (end > lineContentPos && isSpace(src.charCodeAt(end - 1))) end--
        const text = src.slice(lineContentPos, end)
        key = {
          kind: 'scalar',
          value: resolvePlainValue(text),
          source: text,
          style: 'plain',
          start: lineContentPos,
          end,
        }
      }

      state.pos = colon + 1
      skipInlineSpaces(state)

      if (atLineEnd(state)) {
        // Value lives on the following lines (or is empty).
        finishLine(state)
        const child = peekLine(state)
        if (!child.eof && child.indent > indent) {
          state.pos = child.contentPos
          value = parseNode(state, child.indent)
        } else if (!child.eof && child.indent === indent) {
          const cc = src.charCodeAt(child.contentPos)
          if (cc === DASH && (child.contentPos + 1 >= len || isSpace(src.charCodeAt(child.contentPos + 1)))) {
            state.pos = child.contentPos
            value = parseBlockSeq(state, indent)
          }
        }
      } else {
        value = parseInlineValue(state, indent)
        finishLineIfMidLine(state)
      }
    }

    // Duplicate-key tracking. Complex (map/seq) keys have no stable text form, so
    // we skip them rather than collapse every one to the same bucket and falsely
    // report a duplicate.
    if (state.uniqueKeys && (key.kind === 'scalar' || key.kind === 'alias')) {
      const text = keyText(key)
      if (seen) {
        if (seen.has(text)) pushError(state, 'DUPLICATE_KEY', `Map key "${text}" is duplicated`, key.start, key.end)
        else seen.add(text)
      } else if (firstKey === null) {
        firstKey = text
      } else {
        seen = new Set([firstKey])
        if (firstKey === text) pushError(state, 'DUPLICATE_KEY', `Map key "${text}" is duplicated`, key.start, key.end)
        else seen.add(text)
      }
    }
    items.push({ kind: 'pair', key, value, start: key.start, end: value ? value.end : key.end })
  }

  const last = items[items.length - 1]
  const first = items[0]
  const start = first ? first.start : state.pos
  const end = last ? last.end : state.pos
  return { kind: 'map', items, start, end }
}

const parseBlockSeq = (state: State, indent: number): YamlSeq => {
  const { src, len } = state
  const items: YamlNode[] = []
  let startOffset = -1

  // As with `parseBlockMap`, the first entry is at the current cursor; later
  // entries are located with `peekLine` from the line start we end up on.
  let contentPos = state.pos
  let firstEntry = true
  for (;;) {
    if (!firstEntry) {
      const line = peekLine(state)
      if (line.eof || line.indent !== indent) break
      contentPos = line.contentPos
    }
    firstEntry = false
    const c = src.charCodeAt(contentPos)
    if (c !== DASH || (contentPos + 1 < len && !isSpace(src.charCodeAt(contentPos + 1)))) break
    if (startOffset === -1) startOffset = contentPos

    const dashPos = contentPos
    state.pos = dashPos + 1
    skipInlineSpaces(state)

    let item: YamlNode
    if (atLineEnd(state)) {
      finishLine(state)
      const child = peekLine(state)
      if (!child.eof && child.indent > indent) {
        state.pos = child.contentPos
        item = parseNode(state, child.indent)
      } else {
        item = { kind: 'scalar', value: null, source: '', style: 'plain', start: dashPos + 1, end: dashPos + 1 }
      }
    } else {
      const contentCol = state.pos - contentPos + indent
      item = parseNode(state, contentCol)
      finishLineIfMidLine(state)
    }
    items.push(item)
  }

  const last = items[items.length - 1]
  const start = startOffset === -1 ? state.pos : startOffset
  const end = last ? last.end : state.pos
  return { kind: 'seq', items, start, end }
}

/**
 * Parses a block node (mapping, sequence, or scalar) whose first token sits at
 * column `indent`. The cursor is assumed to be at that first token.
 */
const parseNode = (state: State, indent: number): YamlNode => {
  const { src, len } = state
  const c = src.charCodeAt(state.pos)
  if (c === DASH && (state.pos + 1 >= len || isSpace(src.charCodeAt(state.pos + 1)))) {
    return parseBlockSeq(state, indent)
  }

  const props = scanProps(state)
  if (props.anchor || props.tag) {
    skipInlineSpaces(state)
    if (atLineEnd(state)) {
      finishLine(state)
      const child = peekLine(state)
      if (!child.eof && child.indent > indent) {
        state.pos = child.contentPos
        return attachProps(parseNode(state, child.indent), props, state)
      }
      return attachProps(
        { kind: 'scalar', value: null, source: '', style: 'plain', start: state.pos, end: state.pos },
        props,
        state,
      )
    }
  }

  const cc = src.charCodeAt(state.pos)
  if (cc === STAR) return attachProps(scanAlias(state), props, state)
  if (cc === LBRACKET) return attachProps(parseFlowSeq(state), props, state)
  if (cc === LBRACE) return attachProps(parseFlowMap(state), props, state)
  if (cc === PIPE || cc === GT) return attachProps(scanBlockScalar(state, indent - 1), props, state)

  // A line beginning with a quote may be a quoted *key* (e.g. `"200":`), so the
  // mapping check has to come before treating the quote as a standalone scalar.
  const colon = findKeyColon(src, state.pos, len)
  if (colon >= 0) return attachProps(parseBlockMap(state, indent, colon), props, state)
  // An explicit `? key` introducer also starts a mapping; `-1` tells
  // `parseBlockMap` the first entry has no inline colon to reuse.
  if (cc === QUESTION && introducerBoundary(src, state.pos + 1, len)) {
    return attachProps(parseBlockMap(state, indent, -1), props, state)
  }
  if (cc === DQUOTE || cc === SQUOTE) return attachProps(scanQuoted(state, cc), props, state)
  return attachProps(scanPlainScalar(state, indent - 1), props, state)
}

/** Skips a leading BOM, `%`-directives, and a `---` document-start marker. */
const skipDocumentHead = (state: State): void => {
  const { src, len } = state
  if (src.charCodeAt(0) === 0xfeff) state.pos = 1
  for (;;) {
    const line = peekLine(state)
    if (line.eof) return
    const c = src.charCodeAt(line.contentPos)
    if (c === 37 /* % */) {
      state.pos = nextLineStart(src, line.contentPos, len)
      continue
    }
    if (
      c === DASH &&
      src.charCodeAt(line.contentPos + 1) === DASH &&
      src.charCodeAt(line.contentPos + 2) === DASH &&
      (line.contentPos + 3 >= len ||
        isSpace(src.charCodeAt(line.contentPos + 3)) ||
        src.charCodeAt(line.contentPos + 3) === NL)
    ) {
      state.pos = nextLineStart(src, line.contentPos + 3, len)
      continue
    }
    return
  }
}

/**
 * Coerces a scalar's value to honor a `!!`-style core-schema tag. Reached only
 * when a scalar actually carries a tag (rare), so the untagged hot path pays
 * just one `node.tag !== undefined` check. Unknown/custom tags pass through with
 * the value unchanged — the tag stays on the node for callers that want it.
 */
const applyScalarTag = (node: YamlScalar): unknown => {
  const v = node.value
  switch (node.tag) {
    case 'str':
      // For a plain scalar the raw source *is* the string (so `!!str 1.50` keeps
      // its trailing zero); quoted/block styles already resolved to a string.
      return node.style === 'plain' ? node.source : typeof v === 'string' ? v : v === null ? '' : String(v)
    case 'null':
      return null
    case 'bool': {
      const s = node.source
      if (s === 'true' || s === 'True' || s === 'TRUE') return true
      if (s === 'false' || s === 'False' || s === 'FALSE') return false
      return v
    }
    case 'int': {
      if (typeof v === 'number') return Math.trunc(v)
      const n = Number.parseInt(typeof v === 'string' ? v : node.source, 10)
      return Number.isNaN(n) ? v : n
    }
    case 'float': {
      if (typeof v === 'number') return v
      const n = Number.parseFloat(typeof v === 'string' ? v : node.source)
      return Number.isNaN(n) ? v : n
    }
    default:
      return v
  }
}

const toJsValue = (node: YamlNode | null, anchors: Map<string, YamlNode>, merge: boolean): unknown => {
  if (node === null) return null
  if (node.kind === 'scalar') return node.tag !== undefined ? applyScalarTag(node) : node.value
  if (node.kind === 'alias') {
    const target = anchors.get(node.source)
    return target ? toJsValue(target, anchors, merge) : undefined
  }
  if (node.kind === 'seq') {
    // Index loop into a pre-sized array: no per-seq closure (as `.map` allocates)
    // and the result array never reallocates as it grows.
    const items = node.items
    const out = new Array(items.length)
    for (let i = 0; i < items.length; i++) out[i] = toJsValue(items[i] ?? null, anchors, merge)
    return out
  }

  const obj: Record<string, unknown> = {}
  const items = node.items
  for (let i = 0; i < items.length; i++) {
    const pair = items[i]
    if (pair === undefined) continue
    const key = pair.key
    if (merge && key.kind === 'scalar' && key.source === '<<') {
      applyMerge(obj, toJsValue(pair.value, anchors, merge))
      continue
    }
    obj[keyText(key)] = pair.value ? toJsValue(pair.value, anchors, merge) : null
  }
  return obj
}

/** Folds a `<<` merge value (a map or list of maps) into `target` without overriding existing keys. */
const applyMerge = (target: Record<string, unknown>, value: unknown): void => {
  if (Array.isArray(value)) {
    for (const entry of value) applyMerge(target, entry)
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (!(k in target)) target[k] = v
    }
  }
}

const newState = (source: string, options: ParseOptions): State => ({
  src: source,
  len: source.length,
  pos: 0,
  errors: [],
  warnings: [],
  anchors: new Map(),
  uniqueKeys: options.uniqueKeys !== false,
  merge: options.merge !== false,
  line: { eof: false, indent: 0, contentPos: 0 },
})

/** Builds a document from the current `state`, closing over its anchors/problems. */
const finishDocument = (state: State, contents: YamlNode | null): YamlDocument => {
  const { errors, warnings, anchors, merge } = state
  return { contents, errors, warnings, toJS: () => toJsValue(contents, anchors, merge) }
}

/**
 * Parses a YAML document into a node tree with source ranges, collected
 * problems, and a lazy `toJS` projection. Only the first document of a stream is
 * read; use {@link parseAllDocuments} for multi-document (`---`-separated) input.
 */
export const parseDocument = (source: string, options: ParseOptions = {}): YamlDocument => {
  const state = newState(source, options)
  skipDocumentHead(state)
  const head = peekLine(state)
  let contents: YamlNode | null = null
  if (!head.eof) {
    // Stop a bare `...` document-end marker from being read as a scalar.
    const c = source.charCodeAt(head.contentPos)
    const isDocEnd =
      c === 46 /* . */ && source.charCodeAt(head.contentPos + 1) === 46 && source.charCodeAt(head.contentPos + 2) === 46
    if (!isDocEnd) {
      state.pos = head.contentPos
      contents = parseNode(state, head.indent)
    }
  }
  return finishDocument(state, contents)
}

/**
 * Consumes the head of one document in a stream — any `%`-directives, `...`
 * end markers of a preceding document, and a single `---` start marker. Returns
 * whether a `---` start marker was consumed, which marks an explicit (possibly
 * empty) document even when no body follows.
 */
const skipStreamHead = (state: State): boolean => {
  const { src, len } = state
  for (;;) {
    const line = peekLine(state)
    if (line.eof) return false
    const p = line.contentPos
    const c = src.charCodeAt(p)
    if (c === PERCENT) {
      state.pos = nextLineStart(src, p, len)
      continue
    }
    if (c === DOT && isDocMarker(src, p, len)) {
      state.pos = nextLineStart(src, p + 3, len)
      continue
    }
    if (c === DASH && isDocMarker(src, p, len)) {
      state.pos = nextLineStart(src, p + 3, len)
      return true
    }
    return false
  }
}

/**
 * Parses a multi-document YAML stream into one {@link YamlDocument} per `---`
 * separated document. Each document gets its own anchors and problem lists. An
 * empty stream yields an empty array; an explicit bare `---` yields one
 * null-contents document.
 *
 * The single-document hot path is untouched: this is a thin outer loop that only
 * does extra work once a real document boundary appears.
 */
export const parseAllDocuments = (source: string, options: ParseOptions = {}): YamlDocument[] => {
  const state = newState(source, options)
  const { src, len } = state
  if (src.charCodeAt(0) === 0xfeff) state.pos = 1

  const docs: YamlDocument[] = []
  for (;;) {
    const sawStart = skipStreamHead(state)
    const line = peekLine(state)
    let contents: YamlNode | null = null
    let bodyConsumed = false
    if (!line.eof) {
      const p = line.contentPos
      const c = src.charCodeAt(p)
      if (c === DASH && isDocMarker(src, p, len)) {
        // The next document's start marker: the current document is empty. Leave
        // the marker for the next iteration's `skipStreamHead` to consume.
      } else if (c === DOT && isDocMarker(src, p, len)) {
        // A `...` end marker terminates this (empty) document; consume it.
        state.pos = nextLineStart(src, p + 3, len)
      } else {
        state.pos = p
        contents = parseNode(state, line.indent)
        finishLineIfMidLine(state)
        bodyConsumed = true
      }
    }
    if (!sawStart && !bodyConsumed) break
    docs.push(finishDocument(state, contents))
    state.errors = []
    state.warnings = []
    state.anchors = new Map()
  }
  return docs
}
