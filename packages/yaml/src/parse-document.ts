import { resolveDoubleQuoted, resolvePlainValue, resolveSingleQuoted } from './resolve-scalar'
import type {
  ParseOptions,
  YamlAlias,
  YamlDocument,
  YamlError,
  YamlMap,
  YamlNode,
  YamlPair,
  YamlScalar,
  YamlSeq,
} from './types'

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
const LT = 60 // <

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
   * Line start of the most recent tab-indentation error, so the same offending
   * line peeked more than once (child then parent) reports only one error.
   * `-1` until the first tab is seen.
   */
  tabReportedAt: number
  /**
   * Current nesting depth of {@link parseNode}. Guarded against {@link MAX_PARSE_DEPTH}
   * so adversarial input like `[[[[…` cannot recurse the parser into a native
   * stack overflow — it is reported as a parse error instead.
   */
  depth: number
  /**
   * `%TAG` handle prefixes declared for the current document, keyed by the handle
   * *including* its delimiting `!`s (`!`, `!!`, `!e!`). `null` until a document
   * actually declares one, so the overwhelmingly common directive-free document
   * never allocates the map; the two default handles are resolved by
   * {@link handlePrefix} instead of being pre-seeded here.
   */
  tagHandles: Map<string, string> | null
  /** Whether this document already carried a `%YAML` directive (at most one is legal). */
  yamlDirective: boolean
  /**
   * Block indentation the flow collection currently being scanned sits in — the
   * column its continuation lines have to clear. Set by {@link enterFlow} wherever
   * block context opens a `[`/`{`, and read only by {@link checkFlowIndent}, i.e.
   * once per line break a flow collection is written across. A flow collection
   * cannot hold a block one, so the innermost value is always the right one and
   * nothing has to be saved and restored around the nesting.
   */
  flowIndent: number
  /**
   * Whether the current flow collection already reported a continuation line that
   * failed to clear {@link State.flowIndent} — a collection written at the wrong
   * column is usually wrong on every line, and one report per collection is what a
   * diagnostic consumer wants.
   */
  flowIndentReported: boolean
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

const isBreak = (c: number): boolean => c === NL || c === CR

/**
 * True when the `-` at `pos` is a block sequence-entry indicator: a `-` followed
 * by whitespace, a line break, or end of input. A `-` glued to other content
 * (e.g. `-1`) is a plain scalar, and a bare `-` at end of line is an entry with
 * an empty (null) value.
 */
const isSeqEntryDash = (src: string, pos: number, len: number): boolean => {
  if (src.charCodeAt(pos) !== DASH) return false
  const next = src.charCodeAt(pos + 1)
  return pos + 1 >= len || isSpace(next) || next === NL || next === CR
}

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

/**
 * True when a line break separates `from` from `to`. Used to enforce the one
 * rule that makes an implicit key implicit: it has to fit on a single line.
 * Only ever called over a span already known to be short — the whitespace
 * between a key and its `:`, or the key node's own text.
 */
const crossesLine = (src: string, from: number, to: number): boolean => {
  for (let i = from; i < to; i++) {
    const c = src.charCodeAt(i)
    if (c === NL || c === CR) return true
  }
  return false
}

/**
 * Offset just past the next line break (or end of input).
 *
 * YAML 1.2 §5.4 defines `b-break ::= CR LF | CR | LF`, so a lone CR ends a line
 * exactly like an LF does. Every other scanner in this file already treats CR as
 * a break; this one used to look only for LF, which meant a CR-delimited
 * document had all of its lines jumped over in one go — `a: 1\rb: 2\rc: 3\r`
 * parsed to `{ a: 1 }` with no error at all, the worst failure mode a parser
 * built for diagnostics can have. CR LF is consumed as a single break so a
 * Windows document does not gain a phantom empty line between every pair.
 */
const nextLineStart = (src: string, from: number, len: number): number => {
  let i = from
  for (; i < len; i++) {
    const c = src.charCodeAt(i)
    if (c === NL) return i + 1
    if (c === CR) return src.charCodeAt(i + 1) === NL ? i + 2 : i + 1
  }
  return len
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
 *
 * `minIndent` is how many columns of *indentation* the line owes its context —
 * `n` for a sibling entry of a block collection at that column, `n + 1` for a
 * child of it, and 0 at the document root. It only matters when a tab turns up in
 * the leading whitespace: YAML 1.2 spells indentation as spaces
 * (`s-indent ::= s-space × n`), but a tab *past* the indentation is ordinary
 * separation (`s-white`), and the two are told apart only by the column the tab
 * sits at. Every caller knows that column; `peekLine` cannot derive it, which is
 * why reporting used to fire on any leading tab at all and rejected three valid
 * documents (`\t[…]` and `\t{}` at the root, and a `foo:` whose value line reads
 * `⟨space⟩⟨tab⟩bar`). Costs nothing on a tab-free line — the argument is only
 * read on the cold branch below.
 */
const peekLine = (state: State, minIndent: number): LineInfo => {
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
    if (c === TAB) {
      // Cold path: a tab sits in the line's leading whitespace. Skip the run of
      // tabs/spaces to find the real content, then — only once we know content
      // actually follows (a tab-only line is just blank) and the tab really did
      // land inside the indentation the context requires — record a single error
      // and keep parsing.
      let j = i
      while (j < len && (src.charCodeAt(j) === TAB || src.charCodeAt(j) === SPACE)) j++
      const cj = src.charCodeAt(j)
      if (j >= len || cj === NL || cj === CR || cj === HASH) {
        p = nextLineStart(src, j, len)
        continue
      }
      if (i - p < minIndent && state.tabReportedAt !== p) {
        pushError(state, 'TAB_INDENT', 'Tabs cannot be used for indentation', i, j)
        state.tabReportedAt = p
      }
      state.pos = p
      line.eof = false
      line.indent = j - p
      line.contentPos = j
      return line
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

/**
 * Skips the separation whitespace after a block indicator (`-`, `?`, `:`), and
 * reports a tab in it when what follows is a *compact* block collection opened on
 * the indicator's own line.
 *
 * A tab is ordinary separation in front of a scalar or a flow collection — `-\tfoo`
 * and `-\t-1` are both valid documents — but a compact collection takes its
 * indentation from the column it lands on (`s-l+block-indented(n,c) ::=
 * s-indent(m) (ns-l-compact-sequence | ns-l-compact-mapping)`), and indentation is
 * spaces. So `-\t-`, `?\tkey:` and `:\t- x` are invalid where the same shapes
 * written with spaces are not — a distinction that only exists on this line, which
 * is why {@link peekLine}'s indentation check cannot make it.
 *
 * The space run is scanned separately from the tab test so the ordinary path pays
 * exactly what {@link skipInlineSpaces} did: a `SPACE` comparison per character,
 * then one `TAB` comparison. Everything past that comparison is cold.
 */
const skipIndicatorSeparation = (state: State): void => {
  const { src, len } = state
  let p = state.pos
  while (p < len && src.charCodeAt(p) === SPACE) p++
  if (src.charCodeAt(p) === TAB) {
    reportCompactTab(state, p)
    return
  }
  state.pos = p
}

/** The cold half of {@link skipIndicatorSeparation}: a tab really is in the separation. */
const reportCompactTab = (state: State, tabPos: number): void => {
  const { src, len } = state
  let p = tabPos
  while (p < len && isSpace(src.charCodeAt(p))) p++
  state.pos = p
  if (isSeqEntryDash(src, p, len) || findKeyColon(src, p, len) >= 0) {
    pushError(state, 'TAB_INDENT', 'Tabs cannot be used for indentation', tabPos, p)
  }
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
 * flow collections end mid-line and need flushing. The `prev char was a line
 * break` test lets one helper serve every node kind — and it has to accept a
 * lone CR too, or a CR-delimited document flushes a line it already consumed.
 */
const finishLineIfMidLine = (state: State): void => {
  if (state.pos > 0 && state.pos < state.len) {
    const prev = state.src.charCodeAt(state.pos - 1)
    if (prev !== NL && prev !== CR) finishLine(state)
  }
}

const pushError = (state: State, code: string, message: string, start: number, end: number): void => {
  state.errors.push({ kind: 'error', code, message, start, end })
}

const pushWarning = (state: State, code: string, message: string, start: number, end: number): void => {
  state.warnings.push({ kind: 'warning', code, message, start, end })
}

/**
 * The prefix every schema tag shares. A written tag that resolves under it is a
 * core or extended schema tag, and is stored on the node by its short suffix
 * (`str`, `int`, `binary`, …) — the form {@link applyScalarTag} switches on.
 */
const YAML_TAG_PREFIX = 'tag:yaml.org,2002:'

/**
 * Percent-decodes the URI escapes a tag suffix may carry (`%21` → `!`), which is
 * how a tag names a character that would otherwise end the token. Malformed
 * escapes are left alone rather than throwing.
 */
const decodeTagUri = (text: string): string => {
  if (text.indexOf('%') === -1) return text
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** True for the characters a named tag handle may contain, i.e. `!name!` — alphanumerics and `-`. */
const isTagHandleChar = (c: number): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === DASH

/**
 * Resolves a handle (`!`, `!!`, or a named `!x!`) to its prefix. The two default
 * handles are built in — `!` names local tags and `!!` the schema namespace —
 * and either can be overridden by a `%TAG` directive, which is why the
 * document's own map is consulted first.
 */
const handlePrefix = (state: State, handle: string): string | undefined => {
  const declared = state.tagHandles?.get(handle)
  if (declared !== undefined) return declared
  if (handle === '!!') return YAML_TAG_PREFIX
  return handle === '!' ? '!' : undefined
}

/**
 * Turns the tag exactly as written — `!!str`, `!local`, `!e!suffix`, a verbatim
 * `!<uri>`, or the bare non-specific `!` — into the form stored on the node.
 *
 * Schema tags collapse to their short suffix (`!!str` and
 * `!<tag:yaml.org,2002:str>` both become `str`), so a document can reach the
 * core tags by any of the three spellings. Everything else keeps its fully
 * resolved form: a local tag stays `!local`, and a handle declared by `%TAG`
 * expands to the URI it names. That distinction is the point — before it, a
 * local `!str` was indistinguishable from the core `!!str` and wrongly coerced
 * its value.
 *
 * Only ever reached from {@link scanPropsSlow}, i.e. when a node actually
 * carries a tag.
 */
const resolveTag = (state: State, written: string, start: number): string => {
  // The bare `!` is the non-specific tag: it forces resolution as a string
  // rather than naming a type, so it is kept verbatim for `applyScalarTag`.
  if (written === '!') return '!'

  if (written.charCodeAt(1) === LT) {
    // Verbatim `!<uri>` — the URI is used exactly as given, no handle involved.
    const close = written.length - 1
    if (written.charCodeAt(close) !== GT) {
      pushError(state, 'BAD_TAG', 'Verbatim tag is missing its closing ">"', start, start + written.length)
      return written
    }
    return shortenTag(decodeTagUri(written.slice(2, close)))
  }

  // Split off the handle: `!!`, a named `!x!`, or the primary `!`.
  let handleEnd = 1
  if (written.charCodeAt(1) === BANG) {
    handleEnd = 2
  } else {
    let i = 1
    while (i < written.length && isTagHandleChar(written.charCodeAt(i))) i++
    if (i > 1 && written.charCodeAt(i) === BANG) handleEnd = i + 1
  }
  const handle = written.slice(0, handleEnd)
  const suffix = written.slice(handleEnd)
  if (BAD_TAG_CHAR.test(suffix)) {
    pushError(
      state,
      'BAD_TAG',
      `Tag "${written}" contains a character a tag may not hold`,
      start,
      start + written.length,
    )
  }
  const prefix = handlePrefix(state, handle)
  if (prefix === undefined) {
    pushError(
      state,
      'UNKNOWN_TAG_HANDLE',
      `Tag handle "${handle}" was never declared by a %TAG directive`,
      start,
      start + written.length,
    )
    return written
  }
  return shortenTag(prefix + decodeTagUri(suffix))
}

/** Reduces a resolved schema tag to the short suffix the rest of the parser keys off. */
const shortenTag = (tag: string): string => (tag.startsWith(YAML_TAG_PREFIX) ? tag.slice(YAML_TAG_PREFIX.length) : tag)

/** The only shape a `%YAML` version may take. */
const YAML_VERSION = /^\d+\.\d+$/

/**
 * Characters a tag shorthand's suffix may not contain. The spec's `ns-tag-char`
 * excludes the flow indicators so a tag inside `[…]`/`{…}` still has an
 * unambiguous end; a document that means them has to percent-encode them.
 */
const BAD_TAG_CHAR = /[,[\]{}]/

/** Offset of the end of the whitespace-delimited token starting at `from`. */
const tokenEnd = (src: string, from: number, len: number): number => {
  let i = from
  while (i < len) {
    const c = src.charCodeAt(i)
    if (isSpace(c) || c === NL || c === CR) break
    i++
  }
  return i
}

/**
 * Reads one `%`-directive line. Directives are advisory here rather than
 * rewriting how the document parses — with one exception: `%TAG` handles are
 * recorded, because a tag written through a handle cannot be resolved without
 * them. A `%YAML` version is checked and reported but does not switch schemas;
 * the parser always applies the 1.2 core schema.
 *
 * Runs once per directive line, on documents that have any — the directive-free
 * path pays nothing beyond the `%` test that already gated it.
 */
const readDirective = (state: State, pos: number): void => {
  const { src, len } = state
  const nameEnd = tokenEnd(src, pos + 1, len)
  const name = src.slice(pos + 1, nameEnd)
  if (name === 'TAG') {
    let i = nameEnd
    while (i < len && isSpace(src.charCodeAt(i))) i++
    const handleEnd = tokenEnd(src, i, len)
    const handle = src.slice(i, handleEnd)
    let j = handleEnd
    while (j < len && isSpace(src.charCodeAt(j))) j++
    const prefixEnd = tokenEnd(src, j, len)
    const prefix = src.slice(j, prefixEnd)
    if (handle === '' || prefix === '' || handle.charCodeAt(0) !== BANG) {
      pushWarning(state, 'BAD_DIRECTIVE', '%TAG directive needs a handle and a prefix', pos, prefixEnd)
      return
    }
    if (state.tagHandles === null) state.tagHandles = new Map()
    const handles = state.tagHandles
    if (handles.has(handle)) {
      pushWarning(state, 'DUPLICATE_DIRECTIVE', `Tag handle "${handle}" is declared more than once`, pos, prefixEnd)
    }
    handles.set(handle, decodeTagUri(prefix))
    return
  }
  if (name === 'YAML') {
    let i = nameEnd
    while (i < len && isSpace(src.charCodeAt(i))) i++
    const versionEnd = tokenEnd(src, i, len)
    const version = src.slice(i, versionEnd)
    if (state.yamlDirective) {
      pushError(state, 'DUPLICATE_DIRECTIVE', 'A document may carry only one %YAML directive', pos, versionEnd)
    }
    state.yamlDirective = true
    // The version has to *be* a version. Without this `%YAML 1.1#...` read as
    // the 1.1 it starts with and was merely warned about, and anything after it
    // on the line — `%YAML 1.2 foo` — was ignored outright.
    if (!YAML_VERSION.test(version)) {
      pushError(state, 'BAD_DIRECTIVE', `"${version}" is not a valid YAML version`, pos, versionEnd)
      return
    }
    let after = versionEnd
    while (after < len && isSpace(src.charCodeAt(after))) after++
    const trailing = src.charCodeAt(after)
    if (after < len && trailing !== NL && trailing !== CR && trailing !== HASH) {
      pushError(state, 'BAD_DIRECTIVE', 'Unexpected content after the %YAML version', after, tokenEnd(src, after, len))
    }
    if (version !== '1.2') {
      // 1.1 documents parse — they are a near-superset — but their schema
      // differences (`yes`/`no` booleans, `1_000`, sexagesimals) are not applied,
      // so say so rather than silently resolving them by 1.2 rules.
      const message =
        version.startsWith('1.') && version !== ''
          ? `Document declares YAML ${version}; it is parsed with the 1.2 core schema`
          : `Unsupported YAML version "${version}"`
      pushWarning(state, 'UNSUPPORTED_YAML_VERSION', message, pos, versionEnd)
    }
    return
  }
  pushWarning(state, 'UNKNOWN_DIRECTIVE', `Unknown directive "%${name}"`, pos, nameEnd)
}

/**
 * Offset just past the flow collection that opens at `from`, or -1 when it does
 * not close on that line.
 *
 * Only {@link findKeyColon} needs this, and only to answer "is this line a
 * `key: value` entry?" for a line that opens on `[` or `{`. The `: ` separators
 * *inside* a flow collection are its own, not the block entry's, so the scan has
 * to step over the whole collection before it starts looking — without that,
 * `{x: 1}: v` split at the inner colon and keyed the mapping by the plain scalar
 * `{x`, leaving `1}: v` as the value.
 *
 * Stopping at a line break is deliberate rather than a shortcut: an implicit key
 * has to fit on one line, so a collection that runs on is not one, and returning
 * -1 ends the mapping exactly where it did before.
 */
const flowKeyEnd = (src: string, from: number, len: number): number => {
  let depth = 0
  let i = from
  while (i < len) {
    const c = src.charCodeAt(i)
    if (c === NL || c === CR) return -1
    if (c === SQUOTE) {
      // `''` is an escaped quote rather than the close, so step over both.
      i++
      while (i < len) {
        const q = src.charCodeAt(i)
        if (q === NL || q === CR) return -1
        if (q === SQUOTE) {
          if (src.charCodeAt(i + 1) === SQUOTE) i += 2
          else break
        } else i++
      }
    } else if (c === DQUOTE) {
      i++
      while (i < len) {
        const q = src.charCodeAt(i)
        if (q === NL || q === CR) return -1
        if (q === DQUOTE) break
        i += q === 92 /* \ */ ? 2 : 1
      }
    } else if (c === LBRACKET || c === LBRACE) depth++
    else if (c === RBRACKET || c === RBRACE) {
      depth--
      if (depth === 0) return i + 1
    }
    i++
  }
  return -1
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
  // The same goes for a flow collection used as a key.
  const first = src.charCodeAt(from)
  if (first === LBRACKET || first === LBRACE) {
    i = flowKeyEnd(src, from, len)
    if (i < 0) return -1
  } else if (first === SQUOTE) {
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

/**
 * Reads `&anchor` / `!tag` properties that precede a node value on its line.
 *
 * `flow` marks the flow-collection caller, where a `,` or a bracket ends the token
 * with no whitespace in front of it. Without it `!!str,` in `{ foo : !!str, }` read
 * as a tag whose name held the comma — which the tag-character check then reported,
 * while the comma it had swallowed left the mapping looking unterminated and shifted
 * every entry after it. The block caller must *not* stop there: outside a flow
 * collection those characters are ordinary tag content.
 */
const scanProps = (state: State, flow = false): NodeProps => {
  const { src } = state
  const c = src.charCodeAt(state.pos)
  // Fast path: the vast majority of values carry no properties.
  if (c !== AMP && c !== BANG && c !== SPACE && c !== TAB) return NO_PROPS
  return scanPropsSlow(state, flow)
}

/** Offset of the end of a `&anchor` / `!tag` token starting at `from`. */
const propTokenEnd = (src: string, from: number, len: number, flow: boolean): number => {
  let i = from
  while (i < len) {
    const c = src.charCodeAt(i)
    if (isSpace(c) || c === NL || c === CR) break
    if (flow && (c === COMMA || c === LBRACKET || c === RBRACKET || c === LBRACE || c === RBRACE)) break
    i++
  }
  return i
}

const scanPropsSlow = (state: State, flow = false): NodeProps => {
  const { src, len } = state
  let anchor: string | undefined
  let tag: string | undefined
  for (;;) {
    skipInlineSpaces(state)
    const c = src.charCodeAt(state.pos)
    if (c === AMP) {
      const i = propTokenEnd(src, state.pos + 1, len, flow)
      anchor = src.slice(state.pos + 1, i)
      state.pos = i
    } else if (c === BANG) {
      const i = propTokenEnd(src, state.pos + 1, len, flow)
      tag = resolveTag(state, src.slice(state.pos, i), state.pos)
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
  // An alias *is* its target; it names a node rather than being one, so it can
  // carry neither an anchor nor a tag of its own. Both were dropped silently,
  // which made `&b *a` look like it had anchored something.
  if (node.kind === 'alias') {
    pushError(state, 'BAD_PROPERTY', 'An alias cannot carry an anchor or a tag', node.start, node.end)
    if (props.anchor) state.anchors.set(props.anchor, node)
    return node
  }
  if (props.anchor) {
    // Two anchors reaching the same node — `&a` on its own line above a value
    // that carries `&b` — is one node with two names, which the spec does not
    // allow and which silently discarded whichever was applied first.
    if (node.anchor !== undefined) {
      pushError(state, 'BAD_PROPERTY', 'A node cannot carry more than one anchor', node.start, node.end)
    }
    node.anchor = props.anchor
    state.anchors.set(props.anchor, node)
  }
  if (props.tag) node.tag = props.tag
  return node
}

/**
 * The characters a `\` may escape inside a double-quoted scalar, as a 128-entry
 * lookup table: the named escapes (`\n`, `\t`, `\0`, `\N`, `\_`, …), the
 * numeric introducers `x`/`u`/`U`, and the line break a `\` continuation eats.
 * Anything else — `\.`, `\'`, a Windows path's `\U`sers — is not an escape the
 * spec defines, and reading it as the bare letter silently changes the string.
 *
 * A table read is what keeps this affordable: the check runs per backslash, and
 * a double-quoted scalar that carries none never reaches it.
 */
const VALID_ESCAPE = /* @__PURE__ */ (() => {
  const t = new Uint8Array(128)
  for (const c of '0abtnvfre "/\\N_LPxuU\t\n\r') t[c.charCodeAt(0)] = 1
  return t
})()

const reportBadEscape = (state: State, at: number): void => {
  pushError(state, 'BAD_ESCAPE', `"\\${state.src[at + 1]}" is not a valid escape sequence`, at, at + 2)
}

/**
 * Checks the indentation of a continuation line of a multi-line quoted scalar.
 * Every such line has to clear the block indentation the scalar sits in — a
 * scalar whose continuation reaches back to its parent's column is ambiguous
 * with the next entry, and the spec rejects it. Blank lines carry no
 * indentation and are exempt. Called once per line break of a multi-line quoted
 * scalar, so single-line scalars — nearly all of them — never see it.
 */
const checkQuotedIndent = (state: State, lineStart: number, parentIndent: number): boolean => {
  const { src, len } = state
  let i = lineStart
  while (i < len && src.charCodeAt(i) === SPACE) i++
  const c = src.charCodeAt(i)
  if (i >= len || c === NL || c === CR) return false
  if (i - lineStart > parentIndent) return false
  pushError(
    state,
    'BAD_INDENT',
    'A quoted scalar continued over lines must be indented deeper than its parent',
    lineStart,
    i,
  )
  return true
}

/**
 * Reads a single- or double-quoted scalar, including multi-line spans.
 *
 * `parentIndent` is the column its continuation lines have to clear, or -1 to
 * skip the check — for a scalar inside a flow collection, whose enclosing
 * indentation this parser does not track, and for a mapping key, where spanning
 * lines at all is the error {@link parseBlockMap} reports.
 */
const scanQuoted = (state: State, quote: number, parentIndent = -1): YamlScalar => {
  const { src, len } = state
  const start = state.pos
  let i = start + 1
  /** One indentation report per scalar; a wrongly indented block is usually wrong on every line. */
  let indentReported = parentIndent < 0
  // Track whether the closing quote was actually found: a scan that runs to `len`
  // without it is an unterminated scalar that would otherwise swallow the rest of
  // the document silently, so we report it (mirroring eemeli's "Missing closing
  // quote" and the `UNTERMINATED_FLOW` handling for `[`/`{`).
  let closed = false
  // Where the scalar's *content* stops, tracked separately from `i` because the
  // two only coincide when a closing delimiter was consumed. Backing up one
  // character from `i` unconditionally (as this used to) eats the last real
  // character of an unterminated scalar — `a: "abcd` recovered as `"abc"` — and
  // the recovered text is exactly what a linter echoes back at the author.
  let contentEnd = len
  // A `---`/`...` at column 0 ends the document even with a quote still open, so
  // an unterminated quoted scalar stops there instead of swallowing every
  // document after it. The per-character cost is the line-break test; the marker
  // check itself only runs on the line breaks a multi-line quoted scalar has.
  if (quote === SQUOTE) {
    while (i < len) {
      const c = src.charCodeAt(i)
      if (c === SQUOTE) {
        if (src.charCodeAt(i + 1) === SQUOTE) i += 2
        else {
          contentEnd = i
          i++
          closed = true
          break
        }
      } else if (c === NL || c === CR) {
        // The next line starts past the whole break, which `nextLineStart`
        // resolves — CR LF is one break, so `i + 1` would land on the LF and
        // hand `checkQuotedIndent` a phantom empty line to measure.
        const after = nextLineStart(src, i, len)
        if (isDocMarker(src, after, len)) {
          contentEnd = i
          i = after
          break
        }
        if (!indentReported) indentReported = checkQuotedIndent(state, after, parentIndent)
        i = after
      } else i++
    }
  } else {
    while (i < len) {
      const c = src.charCodeAt(i)
      if (c === 92 /* \ */) {
        const e = src.charCodeAt(i + 1)
        if (e < 128 && VALID_ESCAPE[e] === 0) reportBadEscape(state, i)
        i += 2
        continue
      }
      if (c === DQUOTE) {
        contentEnd = i
        i++
        closed = true
        break
      }
      if (c === NL || c === CR) {
        // Same as the single-quoted branch: resolve the break with
        // `nextLineStart` so CR LF advances once and the indent check sees the
        // real next line rather than the LF half of the pair.
        const after = nextLineStart(src, i, len)
        if (isDocMarker(src, after, len)) {
          contentEnd = i
          i = after
          break
        }
        if (!indentReported) indentReported = checkQuotedIndent(state, after, parentIndent)
        i = after
        continue
      }
      i++
    }
  }
  if (!closed) pushError(state, 'UNTERMINATED_QUOTE', 'Missing closing quote', start, i)
  const source = src.slice(start, i)
  const inner = src.slice(start + 1, contentEnd)
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
  // Bind to whichever anchor is currently registered under this name — the one
  // in scope at this point in the document. Capturing the node identity now (not
  // by name at `toJS` time) is what makes a later `&name` redefinition not
  // retroactively change what earlier aliases resolve to.
  const target = state.anchors.get(name)
  const alias: YamlAlias = { kind: 'alias', source: name, start, end: i }
  if (target !== undefined) alias.target = target
  // An anchor must be declared before the alias that uses it, so a miss here is
  // a real error rather than a forward reference to resolve later. Without the
  // report the alias silently projects to `undefined` and its mapping key
  // vanishes from the output — the worst way for a document to be wrong.
  else pushError(state, 'UNRESOLVED_ALIAS', `Alias "*${name}" has no matching anchor`, start, i)
  return alias
}

/**
 * `@` and `` ` `` are reserved indicators in YAML 1.2: they may not begin a plain
 * scalar. The single-operation test works because `c | 32` maps exactly the two
 * of them (64 and 96) onto 96.
 */
const isReservedIndicator = (c: number): boolean => (c | 32) === 96

const reportReservedIndicator = (state: State): void => {
  const pos = state.pos
  pushError(
    state,
    'BAD_SCALAR_START',
    `Reserved indicator "${state.src[pos]}" cannot start a plain scalar`,
    pos,
    pos + 1,
  )
}

/**
 * Reports content left on the line after a node that ends at a delimiter — a
 * flow collection, a quoted scalar, or an alias. Only those kinds need the
 * check: a plain or block scalar absorbs whatever follows as part of its own
 * value, so there is nothing left over to be unexpected.
 */
const checkTrailingContent = (state: State): void => {
  const c = state.src.charCodeAt(state.pos)
  // Fast path: the node ended flush against a line break or end of input — one
  // read and a few comparisons for the shape nearly every document has.
  // (`charCodeAt` past the end yields NaN, which the length test catches.)
  if (c === NL || c === CR || state.pos >= state.len) return
  reportTrailingContent(state, c)
}

/** The cold half of {@link checkTrailingContent}, kept out of it so it stays inlinable. */
const reportTrailingContent = (state: State, c: number): void => {
  if (c === SPACE || c === TAB) {
    skipInlineSpaces(state)
    // A properly separated comment ends the line and is not trailing content.
    if (atLineEnd(state)) return
  }
  const start = state.pos
  // A `#` glued to the node before it (`"value"# comment`) is not a comment: the
  // spec requires whitespace in front of one, and without that rule the rest of
  // the line silently disappears. The source character decides, not the cursor —
  // some callers skip the separating spaces before getting here.
  if (state.src.charCodeAt(start) === HASH) {
    if (start > 0 && isSpace(state.src.charCodeAt(start - 1))) return
    pushError(
      state,
      'BAD_COMMENT',
      'A comment must be preceded by whitespace',
      start,
      plainLineEnd(state.src, start, state.len),
    )
    return
  }
  pushError(
    state,
    'UNEXPECTED_CONTENT',
    'Unexpected content after the end of a node',
    start,
    plainLineEnd(state.src, start, state.len),
  )
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
 * Offset of a `: ` mapping-value indicator inside the plain scalar text
 * `[from, end)`, or -1 when there is none.
 *
 * A plain scalar may not hold one: YAML 1.2's `ns-plain-char` ends the scalar at
 * a `:` that is followed by white space or a line break, which is what makes
 * `a: b: c` and a continuation line like `k1: v1` / ` k2: v2` errors rather than
 * strings. Without the check both fold into the value silently — the author
 * wrote a mapping and got the text of one.
 *
 * `indexOf` does the scanning, so a scalar with no `:` at all — nearly all of
 * them — costs one native pass that finds nothing, rather than a per-character
 * test in {@link plainLineEnd}'s loop. Only a scalar that really does hold a
 * colon (`http://…`, `12:30`) pays for the follow-up comparisons.
 */
const plainColonAt = (src: string, from: number, end: number): number => {
  let i = src.indexOf(':', from)
  while (i !== -1 && i < end) {
    // A `:` at the very end of the scalar's text is followed by the line break
    // `plainLineEnd` trimmed, so it separates just as much as `: ` does.
    if (i + 1 >= end || isSpace(src.charCodeAt(i + 1))) return i
    i = src.indexOf(':', i + 1)
  }
  return -1
}

const reportPlainColon = (state: State, at: number): void => {
  pushError(
    state,
    'BAD_SCALAR_CONTENT',
    'A plain scalar cannot contain ": " — quote the value, or indent it as a nested mapping',
    at,
    at + 1,
  )
}

/**
 * True when a ` #` comment follows the scalar text ending at `from` — i.e. the
 * line the scalar just read ended in a comment rather than in its own content.
 *
 * {@link plainLineEnd} has already trimmed both back, so this only re-reads the
 * few characters between them. Called once per continuation line a plain scalar
 * is about to fold, never for a single-line one.
 */
const endsAtComment = (src: string, from: number, len: number): boolean => {
  let i = from
  while (i < len && isSpace(src.charCodeAt(i))) i++
  return src.charCodeAt(i) === HASH
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
  /** One `: ` report per scalar — a value the author meant as a mapping is wrong once, not once a line. */
  let colonReported = false
  const firstColon = plainColonAt(src, start, valueEnd)
  if (firstColon >= 0) {
    reportPlainColon(state, firstColon)
    colonReported = true
  }

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
    // A comment ends the scalar, so the line below it is not a continuation of
    // anything — it is content the document did not attach to a node, which the
    // document-end check reports. Folding it in instead (as this used to)
    // appended a line the author had commented the scalar closed before.
    if (endsAtComment(src, valueEnd, len)) break
    // Only a top-level scalar (`parentIndent < 0`) can sit at column 0 alongside
    // a `---`/`...` marker; for nested scalars the indent test above already
    // stopped us, so this short-circuits to a single comparison off the hot path.
    // A `%` line is deliberately *not* a stop: the suite's XLQ9 folds one into
    // the scalar, so treating it as a misplaced directive would reject a valid
    // document to catch an invalid one — the worse of the two errors.
    if (parentIndent < 0 && (c === DASH || c === DOT) && isDocMarker(src, i, len)) break
    const lineEnd = plainLineEnd(src, i, len)
    if (!colonReported) {
      const colon = plainColonAt(src, i, lineEnd)
      if (colon >= 0) {
        reportPlainColon(state, colon)
        colonReported = true
      }
    }
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
  // Resolve the folded text through the core schema, just like the single-line
  // path above. Staging a following blank line forces this branch even for a
  // one-line scalar (e.g. `a: 1` before a blank line), so skipping resolution
  // here turned `1`/`true` into the strings `"1"`/`"true"`. A genuinely
  // multi-line plain scalar folds to spaced text that no int/bool/float pattern
  // matches, so it correctly stays a string.
  return { kind: 'scalar', value: resolvePlainValue(folded), source, style: 'plain', start, end: valueEnd }
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

/**
 * Folds the interior lines of a `>` block scalar (indent already stripped, so
 * more-indented lines keep their extra leading spaces). Per YAML 1.2 line
 * folding: a break between two normal (non-empty, non-more-indented) lines folds
 * to a space; any break adjacent to a more-indented line stays literal; and a
 * run of `p` blank lines yields `p` newlines between two normal lines but `p + 1`
 * when either neighbour is more-indented (the entering break is only trimmed
 * when it would otherwise have folded to a space).
 */
const foldBlockFolded = (lines: string[]): string => {
  let out = ''
  let started = false
  let prevMore = false
  let pendingBlanks = 0
  for (const line of lines) {
    // `scanBlockScalar` stores a genuinely empty line as `''` and a
    // whitespace-only line that reaches past the block indent as the leftover
    // spaces — the latter is a more-indented content line, not a fold blank.
    if (line === '') {
      pendingBlanks++
      continue
    }
    // "More indented" means the line begins with white space — a space *or* a
    // tab (the spec's `s-white`). Testing only for a space folded the break
    // around a tab-led line into a space and lost the blank line beside it.
    const curMore = isSpace(line.charCodeAt(0))
    if (!started) {
      // Blank lines before the first content survive as leading line breaks.
      out = '\n'.repeat(pendingBlanks) + line
      started = true
    } else if (pendingBlanks > 0) {
      out += '\n'.repeat(prevMore || curMore ? pendingBlanks + 1 : pendingBlanks) + line
    } else {
      out += (prevMore || curMore ? '\n' : ' ') + line
    }
    prevMore = curMore
    pendingBlanks = 0
  }
  return out
}

/**
 * Checks that a block scalar's header line ends where the indicators do. Past
 * them the line may hold only a comment, and a comment needs whitespace in
 * front of it — so `> text`, `>#comment`, `|0` and `|10` (whose stray `0` the
 * indicator loop leaves behind) are all headers the spec does not allow. Each
 * used to be swallowed, with the leftover text re-read as scalar content.
 *
 * Runs once per block scalar, on the header line only.
 */
const checkBlockHeaderEnd = (state: State): void => {
  const { src, len } = state
  const from = state.pos
  let i = from
  while (i < len && isSpace(src.charCodeAt(i))) i++
  const c = src.charCodeAt(i)
  if (i >= len || c === NL || c === CR) return
  if (c === HASH && i > from) return
  pushError(
    state,
    'BAD_BLOCK_HEADER',
    c === HASH
      ? 'A comment must be preceded by whitespace'
      : 'A block scalar header holds only its chomping and indentation indicators',
    i,
    plainLineEnd(src, i, len),
  )
}

/** Reads a `|` literal or `>` folded block scalar with chomping and indent indicators. */
const scanBlockScalar = (state: State, parentIndent: number): YamlScalar => {
  const { src, len } = state
  const start = state.pos
  const folded = src.charCodeAt(state.pos) === GT
  state.pos++
  let chomp: 'clip' | 'strip' | 'keep' = 'clip'
  let explicitIndent = 0
  let sawChomp = false
  for (;;) {
    const c = src.charCodeAt(state.pos)
    // Each indicator may appear once, in either order (`|2-` and `|-2` are the
    // same header). A repeat — `|--`, `|12` — is not a header the spec allows,
    // and quietly keeping the last one read a document as if it said something
    // it did not.
    if (c === DASH || c === 43 /* + */) {
      if (sawChomp) pushError(state, 'BAD_BLOCK_HEADER', 'Repeated chomping indicator', state.pos, state.pos + 1)
      sawChomp = true
      chomp = c === DASH ? 'strip' : 'keep'
    } else if (c >= 49 && c <= 57 /* 1-9 */) {
      if (explicitIndent !== 0) {
        pushError(state, 'BAD_BLOCK_HEADER', 'Repeated indentation indicator', state.pos, state.pos + 1)
      }
      explicitIndent = c - 48
    } else break
    state.pos++
  }
  checkBlockHeaderEnd(state)
  finishLine(state)

  let contentIndent = explicitIndent ? parentIndent + explicitIndent : -1
  /**
   * Deepest indentation seen on a blank line while the content indent is still
   * unknown. The first content line sets that indent, so a leading blank line
   * that reached further than it would have to be more-indented content of a
   * block that had not started — which the spec makes an error rather than
   * guessing at. Stays -1 once the indent is known (or was given explicitly).
   */
  let leadingBlank = -1
  const lines: string[] = []
  let valueEnd = state.pos
  for (;;) {
    const lineStart = state.pos
    if (lineStart >= len) break
    let i = lineStart
    while (i < len && src.charCodeAt(i) === SPACE) i++
    const c = src.charCodeAt(i)
    const indent = i - lineStart
    // A tab cannot stand in for the block scalar's indentation, so a line whose
    // spaces run out short of it and continue with a tab is not a line of this
    // scalar at all — `foo: |` over a lone `\t` reads as an empty scalar followed
    // by stray content, which is what the loop below already decides. What was
    // missing is saying so: the same line written ` \t` *is* valid content, and
    // the two differ only in the column the tab sits at. One comparison per line
    // of a block scalar, and the branch is taken only when a tab is really there.
    if (c === TAB && indent < (contentIndent === -1 ? parentIndent + 1 : contentIndent)) {
      pushError(state, 'TAB_INDENT', 'Tabs cannot be used for indentation', i, i + 1)
    }
    if (c === NL || c === CR || i >= len) {
      // Whitespace-only line. Once the content indent is known, anything beyond
      // it is real content (literal scalars preserve that extra indentation).
      lines.push(contentIndent !== -1 && indent > contentIndent ? ' '.repeat(indent - contentIndent) : '')
      if (contentIndent === -1 && indent > leadingBlank) leadingBlank = indent
      state.pos = nextLineStart(src, i, len)
      continue
    }
    if (contentIndent === -1) {
      if (indent <= parentIndent) break
      contentIndent = indent
      if (leadingBlank > indent) {
        pushError(
          state,
          'BAD_INDENT',
          'A leading blank line of a block scalar is indented deeper than its first content line',
          lineStart,
          i,
        )
      }
    }
    if (indent < contentIndent) break
    // A block scalar whose content sits at column 0 — only possible at the
    // document root — still ends at a `---`/`...` marker, which outranks it.
    // The `indent === 0` gate means an indented block scalar (every other one)
    // pays a single integer comparison per line and never looks further.
    if (indent === 0 && (c === DASH || c === DOT) && isDocMarker(src, i, len)) break
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
  const body = folded ? foldBlockFolded(lines) : lines.join('\n')
  // Chomping decides the trailing break: `strip` (`-`) drops it entirely (so
  // `value` is just `body`), `keep` (`+`) preserves every trailing blank plus the
  // final line break, and the default `clip` keeps a single trailing newline.
  let value: string
  if (chomp === 'keep') value = body + '\n'.repeat(trailingBlanks + (lines.length ? 1 : 0))
  else if (chomp === 'clip') value = body + (lines.length ? '\n' : '')
  else value = body

  return {
    kind: 'scalar',
    value,
    source: src.slice(start, valueEnd),
    style: folded ? 'block-folded' : 'block-literal',
    start,
    end: valueEnd,
  }
}

/**
 * Records the block indentation a flow collection opened from block context sits
 * in, so {@link checkFlowIndent} can hold its continuation lines to it. Called at
 * the two places block context reaches a `[`/`{`; a nested flow collection keeps
 * the enclosing block's column, which is the looser of the two readings the spec
 * allows and so can never reject a document it should accept.
 */
const enterFlow = (state: State, blockIndent: number): void => {
  state.flowIndent = blockIndent
  state.flowIndentReported = false
}

/**
 * Checks that a line a flow collection is continued onto clears the indentation of
 * the block that holds the collection. YAML 1.2 requires it — `ns-flow-node(n+1)`
 * inside `s-l+flow-in-block(n)`, with every continuation line prefixed by
 * `s-flow-line-prefix(n+1)` — and without the check a flow collection written back
 * at its parent's own column reads exactly like a properly indented one, so
 * `flow: [a,` over a column-0 `b,` parsed clean.
 *
 * Indentation is counted in *spaces* only, which folds the tab rule in for free: a
 * tab is separation, so it cannot make up the shortfall, and a line whose
 * whitespace is nothing but tabs is blank and exempt.
 *
 * A line that opens on the collection's *closing* delimiter is held to the parent's
 * own column rather than one past it. The spec asks for one past, but
 *
 *     flow: [
 *       a,
 *       b,
 *     ]
 *
 * is how everything from Prettier to hand-written Kubernetes manifests closes a
 * multi-line flow collection, and both `yaml` (eemeli) and `js-yaml` accept it.
 * Rejecting a document that ubiquitous to enforce a column is the wrong trade; a
 * closing bracket *further out* than its parent (`c: [` at column 4 over a `]` at
 * column 0) is still reported, which is where the two parsers agree.
 *
 * Runs once per line break inside a flow collection, so a single-line `{ … }` — the
 * shape configuration and OpenAPI documents are full of — never reaches it.
 */
const checkFlowIndent = (state: State, lineStart: number): void => {
  const { src, len } = state
  let i = lineStart
  while (i < len && src.charCodeAt(i) === SPACE) i++
  let c = src.charCodeAt(i)
  if (c === TAB) {
    // Look past the tab run only to answer "is there content on this line at
    // all"; the spaces before it are still all the indentation the line has.
    let j = i
    while (j < len && isSpace(src.charCodeAt(j))) j++
    c = src.charCodeAt(j)
    if (j >= len) return
  }
  // A blank line, or one holding only a comment, carries no indentation to judge.
  if (i >= len || c === NL || c === CR || c === HASH) return
  const indent = i - lineStart
  if (indent > state.flowIndent) return
  if ((c === RBRACKET || c === RBRACE) && indent >= state.flowIndent) return
  state.flowIndentReported = true
  pushError(
    state,
    'BAD_INDENT',
    'A flow collection continued over lines must be indented deeper than its parent',
    lineStart,
    i,
  )
}

/** Skips whitespace, line breaks, and comments — used between flow tokens. */
const skipFlowWs = (state: State): void => {
  const { src, len } = state
  let p = state.pos
  while (p < len) {
    const c = src.charCodeAt(p)
    if (c === SPACE || c === TAB) {
      p++
    } else if (c === NL || c === CR) {
      p++
      // A `---`/`...` at column 0 belongs to the stream, not to the collection
      // that is still open around it: a flow collection may not span a document
      // boundary. The check costs one comparison per line break a flow
      // collection is written across, and nothing at all on a single-line one.
      const d = src.charCodeAt(p)
      if ((d === DASH || d === DOT) && isDocMarker(src, p, len)) {
        pushError(state, 'UNEXPECTED_CONTENT', 'A document marker cannot appear inside a flow collection', p, p + 3)
      } else if (!state.flowIndentReported) checkFlowIndent(state, p)
    } else if (c === HASH) {
      // The spec requires whitespace before a comment, so a `#` glued to the
      // token in front of it (`[ a, b,#not a comment`) is not one — and reading
      // it as one silently drops the rest of the line.
      if (p > 0 && !isSpace(src.charCodeAt(p - 1)) && !isBreak(src.charCodeAt(p - 1))) {
        pushError(state, 'BAD_COMMENT', 'A comment must be preceded by whitespace', p, plainLineEnd(src, p, len))
      }
      p = nextLineStart(src, p, len)
    } else break
  }
  state.pos = p
}

/**
 * Advances to where a flow plain scalar ends *on the current line* — the first
 * flow indicator (`,` `[` `]` `{` `}`), a `:` that separates a key from a value,
 * a ` #` comment, or a line break. `lineStart` is the offset the current line's
 * content began at, so the ` #` comment rule only fires when a space precedes it.
 */
const flowPlainLineEnd = (src: string, from: number, lineStart: number, len: number): number => {
  let i = from
  while (i < len) {
    const c = src.charCodeAt(i)
    if (c === COMMA || c === LBRACKET || c === RBRACKET || c === LBRACE || c === RBRACE || c === NL || c === CR) break
    if (c === COLON) {
      const n = src.charCodeAt(i + 1)
      if (i + 1 >= len || isSpace(n) || n === COMMA || n === RBRACKET || n === RBRACE || n === NL || n === CR) break
    }
    if (c === HASH && i > lineStart && isSpace(src.charCodeAt(i - 1))) break
    i++
  }
  return i
}

/**
 * Reads a plain scalar inside a flow collection. It runs until a flow indicator,
 * so — unlike a block plain scalar — it can wrap across lines with no leading
 * `-`/`:` to stop it. Continuation lines are folded per YAML 1.2 flow folding
 * (single break → space, a run of *n* breaks → *n − 1* newlines), the same rule
 * {@link foldSegments} applies to block plain scalars; leading indentation on
 * each wrapped line is not significant and is trimmed away.
 */
const scanFlowPlain = (state: State): YamlScalar => {
  const { src, len } = state
  const start = state.pos
  const i = flowPlainLineEnd(src, start, start, len)
  let firstEnd = i
  while (firstEnd > start && isSpace(src.charCodeAt(firstEnd - 1))) firstEnd--

  // Fast path — the scalar fits on one line (the overwhelmingly common case), so
  // it stopped on a flow indicator, not a line break. No segment array needed.
  const stop = i < len ? src.charCodeAt(i) : 0
  if (stop !== NL && stop !== CR) {
    const text = src.slice(start, firstEnd)
    state.pos = i
    return { kind: 'scalar', value: resolvePlainValue(text), source: text, style: 'plain', start, end: firstEnd }
  }

  // The scalar wraps. Gather each continuation line as a segment, staging blank
  // lines so a run of them collapses to the right number of newlines.
  const segments: string[] = [src.slice(start, firstEnd)]
  let valueEnd = firstEnd
  let scan = nextLineStart(src, i, len)
  for (;;) {
    if (scan >= len) break
    let j = scan
    // A wrapped flow line's leading whitespace is `s-flow-line-prefix(n) ::=
    // s-indent(n) s-separate-in-line?`, and `s-separate-in-line` is `s-white+` — so
    // tabs sit in it just as spaces do, and none of it is content. Skipping only
    // spaces left the cursor parked on a tab, which no branch below recognizes:
    // the `]` that ended a tab-indented line was not seen as the flow indicator it
    // is, and the line folded into the scalar as an empty segment. That is how
    // `JSON.stringify(value, null, '\t')` — tab-indented JSON, which every editor
    // and `jq --tab` emits — turned the last entry before a `]` into a string with
    // a trailing newline: `-1` came back as `"-1\n"`.
    while (j < len && isSpace(src.charCodeAt(j))) j++
    const c = j < len ? src.charCodeAt(j) : 0
    if (c === NL || c === CR) {
      segments.push('')
      scan = nextLineStart(src, j, len)
      continue
    }
    // A line that opens on a flow indicator ends the scalar; the collection
    // parser resumes at that indicator (or an unterminated-flow report there).
    if (j >= len || c === COMMA || c === LBRACKET || c === RBRACKET || c === LBRACE || c === RBRACE) break
    // A `---`/`...` at column 0 ends the document, so it cannot be folded into a
    // scalar the flow collection above it left open. Gated on the line starting
    // at column 0, which a wrapped flow scalar's continuation almost never does.
    if (j === scan && (c === DASH || c === DOT) && isDocMarker(src, j, len)) break
    // So does a line that opens on the `: ` that separates this key from its
    // value, or on a comment. Both used to be swallowed as continuation text,
    // which left the key carrying a trailing newline (`{foo\n: bar}` keyed the
    // mapping by `"foo\n"`) or the comment glued onto the value.
    if (c === HASH) break
    if (c === COLON) {
      const n = src.charCodeAt(j + 1)
      if (j + 1 >= len || isSpace(n) || n === COMMA || n === RBRACKET || n === RBRACE || n === NL || n === CR) break
    }
    const lineEnd = flowPlainLineEnd(src, j, j, len)
    let e = lineEnd
    while (e > j && isSpace(src.charCodeAt(e - 1))) e--
    segments.push(src.slice(j, e))
    valueEnd = e
    // Stop unless this line ended at a bare line break; a mid-line flow
    // indicator (e.g. the `,` in `b,`) closes the scalar right here.
    if (lineEnd >= len || (src.charCodeAt(lineEnd) !== NL && src.charCodeAt(lineEnd) !== CR)) {
      state.pos = lineEnd
      const source = src.slice(start, valueEnd)
      return { kind: 'scalar', value: resolveFlowPlain(segments), source, style: 'plain', start, end: valueEnd }
    }
    scan = nextLineStart(src, lineEnd, len)
  }

  // Reached end of input (or a leading flow indicator) with the scalar still
  // open. Drop trailing blank segments; the flow parser handles what follows.
  while (segments.length > 1 && segments[segments.length - 1] === '') segments.pop()
  state.pos = valueEnd
  const source = src.slice(start, valueEnd)
  return { kind: 'scalar', value: resolveFlowPlain(segments), source, style: 'plain', start, end: valueEnd }
}

/**
 * Folds a wrapped flow plain scalar and resolves it through the core schema.
 *
 * The resolution is the point: `scanFlowPlain` reaches this path whenever the
 * scalar is the last thing on its line, which is every entry of a flow
 * collection written across lines — so `{ a: 1,\n  b: 2 }` used to yield the
 * *string* `"2"` for `b` while the single-line `{ a: 1, b: 2 }` yielded the
 * number. A genuinely multi-line scalar folds to spaced text that no number or
 * boolean pattern matches, so it still resolves to a string, exactly as
 * {@link scanPlainScalar} does for the block form.
 */
const resolveFlowPlain = (segments: string[]): string | number | boolean | null =>
  resolvePlainValue(foldSegments(segments))

const parseFlowNode = (state: State): YamlNode => {
  // Flow collections recurse through here rather than `parseNode`, so they need
  // their own depth guard against input like `[`-repeated-100000-times. Both
  // paths share `state.depth`, so mixed block/flow nesting is bounded together.
  if (state.depth >= MAX_PARSE_DEPTH) {
    const pos = state.pos
    pushError(state, 'DEPTH_LIMIT', `Exceeded maximum nesting depth of ${MAX_PARSE_DEPTH}`, pos, pos)
    state.pos = state.len
    return { kind: 'scalar', value: null, source: '', style: 'plain', start: pos, end: pos }
  }
  state.depth++
  const node = parseFlowNodeInner(state)
  state.depth--
  return node
}

const parseFlowNodeInner = (state: State): YamlNode => {
  skipFlowWs(state)
  const props = scanProps(state, true)
  skipFlowWs(state)
  const c = state.src.charCodeAt(state.pos)
  let node: YamlNode
  if (c === LBRACKET) node = parseFlowSeq(state)
  else if (c === LBRACE) node = parseFlowMap(state)
  else if (c === DQUOTE || c === SQUOTE) node = scanQuoted(state, c)
  else if (c === STAR) node = scanAlias(state)
  else {
    if (isReservedIndicator(c)) reportReservedIndicator(state)
    // `-` is the block sequence indicator and has no meaning inside a flow
    // collection, so `[-]` and `[-, -]` are not sequences of anything — they
    // read as the plain scalar `"-"`, which is not what the document says.
    // (`-1` and `-x` are ordinary plain scalars and never reach here.)
    else if (c === DASH && flowIndicatorBoundary(state.src, state.pos + 1, state.len)) {
      pushError(
        state,
        'BAD_SCALAR_START',
        'A "-" sequence indicator cannot start a flow collection entry',
        state.pos,
        state.pos + 1,
      )
    }
    node = scanFlowPlain(state)
  }
  return attachProps(node, props, state)
}

/**
 * True when the character at `after` ends a token inside a flow collection —
 * whitespace, a line break, a `,`, a closing bracket, or end of input. The flow
 * counterpart of {@link introducerBoundary}, which does not know about the flow
 * delimiters that end a token without any whitespace.
 */
const flowIndicatorBoundary = (src: string, after: number, len: number): boolean => {
  if (after >= len) return true
  const c = src.charCodeAt(after)
  return isSpace(c) || isBreak(c) || c === COMMA || c === RBRACKET || c === RBRACE
}

/**
 * Consumes an explicit `? ` key introducer inside a flow collection. The entry
 * that follows is parsed exactly like an implicit one — the `?` only marks the
 * key, it does not change its shape — so skipping it is the whole job.
 *
 * Returns whether it found one, which is the one thing the `?` does change: the
 * key it introduces is explicit, so the rule that exists only to keep an
 * *implicit* key cheap to recognize — that it fits on one line — does not bind it,
 * and `[ ? a\n : b ]` is a valid entry where `[ a\n : b ]` is not.
 */
const skipFlowExplicitKey = (state: State): boolean => {
  if (state.src.charCodeAt(state.pos) === QUESTION && introducerBoundary(state.src, state.pos + 1, state.len)) {
    state.pos++
    skipFlowWs(state)
    return true
  }
  return false
}

/**
 * Reports a single-pair sequence entry whose `:` sits on a line below its key
 * (`[ key\n : value ]`). The compact `[ key: value ]` form is built on an
 * *implicit* key, which by definition fits on one line — unlike an entry of a
 * flow *mapping*, where the spec's separation rules do let `{ "foo"\n: bar }`
 * put the `:` on the next line, so this check belongs only to the sequence.
 *
 * `afterKey` is where the key node ended; only the whitespace between it and
 * the `:` is scanned, and only once a `:` is actually there.
 */
const checkImplicitKeyLine = (state: State, afterKey: number): void => {
  if (crossesLine(state.src, afterKey, state.pos)) {
    pushError(
      state,
      'BAD_IMPLICIT_KEY',
      'An implicit key must be followed by its ":" on the same line',
      afterKey,
      state.pos + 1,
    )
  }
}

/**
 * How far past the start of an implicit key its `:` may sit. YAML 1.2 caps it
 * (§7.4.2, `ns-s-implicit-yaml-key(c)`: "the ':' indicator must appear at most
 * 1024 Unicode characters beyond the start of the key") so a processor can decide
 * whether a line is a mapping entry with bounded lookahead.
 *
 * Enforced in **block** context only, matching `yaml` (eemeli). The spec writes the
 * same cap into the flow-context production, but a flow mapping is where JSON
 * lives — `{"…1100 characters…": 1}` is valid JSON — and this package's whole
 * premise is that JSON parses as YAML. Rejecting a valid JSON document to enforce a
 * lookahead bound the flow scanner does not need is the worse of the two errors.
 */
const MAX_IMPLICIT_KEY_LENGTH = 1024

/**
 * Reports a block-context implicit key whose `:` sits further past the key's start
 * than the spec allows.
 *
 * The caller already holds both offsets, so enforcing the rule is a subtraction and
 * a comparison — the "lookahead the hot path does not do" this was previously
 * documented as needing turned out to be lookahead `findKeyColon` had already done.
 * The comparison stays at the call site (a mapping entry is the parser's hottest
 * unit of work) and only the report lives here.
 *
 * Offsets are UTF-16 code units rather than Unicode characters, so a key built from
 * astral characters is measured slightly short of its true length; at four figures
 * of key text that is not a distinction worth a second pass to make.
 */
const reportLongImplicitKey = (state: State, keyStart: number, colon: number): void => {
  pushError(
    state,
    'BAD_IMPLICIT_KEY',
    `An implicit key may not run more than ${MAX_IMPLICIT_KEY_LENGTH} characters before its ":"`,
    keyStart,
    colon + 1,
  )
}

/**
 * Reports and consumes a `,` sitting where a value belongs (`[1,,2]`). Returns
 * whether it did, so the caller restarts its entry loop. A comma *before* the
 * closing bracket is the legal trailing comma and never reaches here — the
 * caller checks for the closing bracket first.
 */
const skipEmptyFlowEntry = (state: State): boolean => {
  if (state.src.charCodeAt(state.pos) !== COMMA) return false
  pushError(state, 'UNEXPECTED_COMMA', 'Missing value before ","', state.pos, state.pos + 1)
  state.pos++
  return true
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
    if (skipEmptyFlowEntry(state)) continue
    const explicitKey = skipFlowExplicitKey(state)
    const item = parseFlowNode(state)
    const afterItem = state.pos
    skipFlowWs(state)
    if (state.src.charCodeAt(state.pos) === COLON) {
      // `[ key: value ]` — an implicit single-pair mapping as a sequence entry
      // (the shape `!!omap` is written in). Only reached when an item is actually
      // followed by a colon, so plain `[a, b]` sequences pay nothing extra.
      if (!explicitKey) checkImplicitKeyLine(state, afterItem)
      state.pos++
      skipFlowWs(state)
      const vc = state.src.charCodeAt(state.pos)
      const value = vc === COMMA || vc === RBRACKET || state.pos >= state.len ? null : parseFlowNode(state)
      const pair: YamlPair = { kind: 'pair', key: item, value, start: item.start, end: value ? value.end : item.end }
      items.push({ kind: 'map', items: [pair], start: item.start, end: pair.end })
      skipFlowWs(state)
    } else {
      items.push(item)
    }
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

/**
 * Map size at which duplicate-key tracking switches from scanning the pairs
 * collected so far to a `Set`. Below it a linear scan wins outright: real
 * documents are dominated by tiny mappings (OpenAPI averages under three keys
 * per map), and allocating a `Set` to deduplicate two or three strings costs
 * far more than comparing them. Above it the scan's O(n^2) growth would start
 * to matter, so we pay for the `Set` once and hash from there on.
 */
const SET_THRESHOLD = 8

/**
 * Reports `key` if an earlier pair in `items` already used it, and returns the
 * tracking `Set` to carry into the next call (`null` while the map is still
 * small enough to scan). Shared by the block and flow mapping parsers, which
 * track duplicates identically.
 *
 * Every key kind is tracked, collection keys included. They used to be skipped,
 * on the grounds that they had no stable text form — true when the skip was
 * written, but {@link keyText} renders them in flow style now, and `toJS` keys
 * the projected object by exactly that string. So two collection keys that
 * render alike really do collide, and skipping them meant the second value
 * silently overwrote the first with nothing reported.
 */
const trackKey = (state: State, items: YamlPair[], key: YamlNode, seen: Set<string> | null): Set<string> | null => {
  const text = keyText(key)
  if (seen === null && items.length >= SET_THRESHOLD) {
    seen = new Set()
    for (let i = 0; i < items.length; i++) {
      const k = items[i]?.key
      if (k !== undefined) seen.add(keyText(k))
    }
  }
  if (seen !== null) {
    if (seen.has(text)) pushError(state, 'DUPLICATE_KEY', `Map key "${text}" is duplicated`, key.start, key.end)
    else seen.add(text)
    return seen
  }
  for (let i = 0; i < items.length; i++) {
    const k = items[i]?.key
    if (k !== undefined && keyText(k) === text) {
      pushError(state, 'DUPLICATE_KEY', `Map key "${text}" is duplicated`, key.start, key.end)
      break
    }
  }
  return null
}

const parseFlowMap = (state: State): YamlMap => {
  const start = state.pos
  state.pos++ // {
  const items: YamlPair[] = []
  // Flow maps enforce `uniqueKeys` just like block maps do; see `trackKey`.
  let seen: Set<string> | null = null
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
    if (skipEmptyFlowEntry(state)) continue
    skipFlowExplicitKey(state)
    const key = parseFlowNode(state)
    skipFlowWs(state)
    let value: YamlNode | null = null
    if (state.src.charCodeAt(state.pos) === COLON) {
      state.pos++
      skipFlowWs(state)
      const vc = state.src.charCodeAt(state.pos)
      if (vc !== COMMA && vc !== RBRACE) value = parseFlowNode(state)
    }
    if (state.uniqueKeys) seen = trackKey(state, items, key, seen)
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

/**
 * Resolves a value written as `&anchor` / `!tag` with nothing after it on the
 * line: either the block node indented below, or — when there is none — an empty
 * node the properties can attach to.
 *
 * Split out of {@link parseInlineValue} rather than inlined into it: this runs
 * only for a value that carries properties and no inline content, while the
 * function it came from runs for every mapping value in the document.
 */
const parsePropsOnlyValue = (state: State, props: NodeProps, parentIndent: number): YamlNode => {
  const propsEnd = state.pos
  finishLine(state)
  const child = peekLine(state, parentIndent + 1)
  if (!child.eof && child.indent > parentIndent) {
    state.pos = child.contentPos
    return attachProps(parseNode(state, child.indent, parentIndent), props, state)
  }
  // A block sequence is the one collection allowed to sit at its mapping's own
  // column, so `sequence: !!seq` over a zero-indented `- entry` list is the tag
  // describing that list. The untagged shape (`sequence:` / `- entry`) has
  // always been read this way in `parseBlockMap`; without the same rule here the
  // tag ended an empty node and the sequence was left for the document-end check
  // to report as stray content.
  if (!child.eof && child.indent === parentIndent && isSeqEntryDash(state.src, child.contentPos, state.len)) {
    state.pos = child.contentPos
    return attachProps(parseBlockSeq(state, parentIndent), props, state)
  }
  // Nothing below to describe, so the properties belong to an empty node
  // (`a: &anchor`). It has to be materialized rather than collapsed to a plain
  // `null`: without a node there is nothing to register the anchor against, and
  // a later `*anchor` — which is legal, and resolves to null — would dangle.
  return attachProps(
    { kind: 'scalar', value: null, source: '', style: 'plain', start: propsEnd, end: propsEnd },
    props,
    state,
  )
}

/** Parses the inline value that follows a `key:` separator on the same line. */
const parseInlineValue = (state: State, parentIndent: number): YamlNode | null => {
  const props = scanProps(state)
  skipInlineSpaces(state)
  if (atLineEnd(state)) {
    // Properties with no inline value: the real value is the block node below.
    if (props.anchor || props.tag) return parsePropsOnlyValue(state, props, parentIndent)
    return null
  }
  const c = state.src.charCodeAt(state.pos)
  let node: YamlNode
  // Aliases, flow collections, and quoted scalars stop at a delimiter rather
  // than at end of line, so anything left on the line after them is content the
  // document did not mean to write. Plain and block scalars absorb it instead,
  // which is why the check sits in the branches rather than after them — the
  // common plain-scalar value must not pay for it.
  if (c === STAR) {
    node = scanAlias(state)
    checkTrailingContent(state)
  } else if (c === PIPE || c === GT) node = scanBlockScalar(state, parentIndent)
  else if (c === LBRACKET) {
    enterFlow(state, parentIndent)
    node = parseFlowSeq(state)
    checkTrailingContent(state)
  } else if (c === LBRACE) {
    enterFlow(state, parentIndent)
    node = parseFlowMap(state)
    checkTrailingContent(state)
  } else if (c === DQUOTE || c === SQUOTE) {
    node = scanQuoted(state, c, parentIndent)
    checkTrailingContent(state)
  } else {
    if (isReservedIndicator(c)) reportReservedIndicator(state)
    // A block sequence may open on the `:` line of an *explicit* key, and
    // `parseValueOrChild` takes that shape before it ever gets here. Reaching a
    // `- ` entry indicator on this path therefore means the key was implicit
    // (`key: - a`), which the spec does not allow — the entries below have no
    // column to align under. It folded into the value as the text `"- a - b"`.
    else if (c === DASH && isSeqEntryDash(state.src, state.pos, state.len)) {
      pushError(
        state,
        'UNEXPECTED_CONTENT',
        'A block sequence cannot start on the line of the key it belongs to',
        state.pos,
        state.pos + 1,
      )
    }
    node = scanPlainScalar(state, parentIndent)
  }
  return attachProps(node, props, state)
}

/**
 * The column `pos` sits at, counted back to the start of its line. Only reached
 * when a block collection is found opening on a `?`/`:` introducer line: that
 * column is the indentation its remaining entries align under, and nothing on
 * the way here recorded it.
 */
const columnOf = (src: string, pos: number): number => {
  let i = pos
  while (i > 0 && !isBreak(src.charCodeAt(i - 1))) i--
  return pos - i
}

/**
 * Parses the node that follows an explicit `?` or `:` introducer: either an
 * inline value on the same line, or a block node on the deeper-indented lines
 * below. Mirrors the implicit `key:` value handling but is reached only on the
 * cold explicit-entry path, so the hot block-mapping loop stays untouched.
 *
 * `compact` marks the two callers where the introducer really is a `?`/`:`
 * token, which the spec lets a block collection open on — `? a` / `: - b` is a
 * sequence whose first entry shares the `:` line (`ns-l-compact-sequence`), and
 * `? earth: blue` a mapping whose first entry shares the `?` line. The other
 * caller hands over an *implicit* key (`[a, b]: …`), where the same shape is
 * invalid and has to stay an ordinary inline value so it gets reported.
 */
const parseValueOrChild = (state: State, indent: number, compact = false): YamlNode | null => {
  const { src, len } = state
  // Only the `compact` callers can legally open a collection here, so only they
  // owe the indentation-is-spaces rule; the implicit-key caller's version of this
  // shape is reported as the invalid nesting it is, further down.
  if (compact) skipIndicatorSeparation(state)
  else skipInlineSpaces(state)
  if (atLineEnd(state)) {
    finishLine(state)
    const child = peekLine(state, indent + 1)
    if (!child.eof && child.indent > indent) {
      state.pos = child.contentPos
      return parseNode(state, child.indent, indent)
    }
    if (!child.eof && child.indent === indent) {
      if (isSeqEntryDash(src, child.contentPos, len)) {
        state.pos = child.contentPos
        return parseBlockSeq(state, indent)
      }
    }
    return null
  }
  if (compact) {
    // Both shapes set their own indentation from the column the first entry
    // landed on, which is past the introducer rather than at it.
    if (isSeqEntryDash(src, state.pos, len)) return parseBlockSeq(state, columnOf(src, state.pos))
    const colon = findKeyColon(src, state.pos, len)
    if (colon >= 0) return parseBlockMap(state, columnOf(src, state.pos), colon)
  }
  const node = parseInlineValue(state, indent)
  finishLineIfMidLine(state)
  return node
}

/**
 * The string a key projects to in the plain JavaScript output, and the identity
 * duplicate-key tracking compares on.
 *
 * A JavaScript object can only be keyed by a string, so every key kind has to
 * reduce to one: an alias resolves through to whatever it points at (a key
 * written `*ref` means the anchored value, not the literal text), and a
 * collection key renders in flow style. Both used to collapse — to `*ref` and to
 * the empty string respectively — which silently merged distinct keys.
 *
 * Exported because anything that addresses a node *by* the key `toJS()` produced
 * has to agree with this exactly. `nodeAtPath` learned that the hard way: it
 * carried its own simplified version that returned `'null'` for a null key,
 * `'*ref'` for an alias, and `''` for every collection key — so the three key
 * kinds this function handles specially were unreachable by path, and a
 * `closest` lookup quietly reported the *parent's* source span instead.
 */
export const keyText = (node: YamlNode): string => {
  if (node.kind === 'scalar') {
    const v = node.value
    // Keys are usually strings already — skip the String() round-trip.
    if (typeof v === 'string') return v
    // An empty key is null in YAML and stringifies to '' — the same key `? ` and
    // an empty quoted string produce, which is what a JS object can express.
    return v === null ? '' : String(v)
  }
  return keyTextSlow(node)
}

/**
 * The non-scalar half of {@link keyText}, split out for the same reason
 * `scanPropsSlow` is: duplicate-key tracking calls `keyText` for every mapping
 * key, and keeping the scalar case in a small non-recursive function leaves it
 * inlinable at that call site.
 */
const keyTextSlow = (node: YamlNode): string => {
  if (node.kind === 'alias') return node.target ? keyText(node.target) : '*' + node.source
  return stringifyFlow(node)
}

/**
 * Renders a node as it would read inside a flow collection. Distinct from
 * {@link keyText}, which produces the string a JavaScript object is keyed by:
 * there an empty scalar is `''` (the only thing an object key can be), while
 * here it reads as `null`, because `{ a: null }` is what the source said and
 * `{ a:  }` is not a rendering of anything.
 */
const flowText = (node: YamlNode): string => {
  if (node.kind === 'scalar') {
    const v = node.value
    return typeof v === 'string' ? v : v === null ? 'null' : String(v)
  }
  if (node.kind === 'alias') return node.target ? flowText(node.target) : '*' + node.source
  return stringifyFlow(node)
}

/**
 * Renders a collection used as a mapping key in flow style, so distinct keys get
 * distinct strings. Recursion is bounded by the same nesting the parser accepted
 * ({@link MAX_PARSE_DEPTH}), and only runs for the rare document that keys a
 * mapping by a collection.
 */
const stringifyFlow = (node: YamlNode): string => {
  if (node.kind === 'seq') {
    if (node.items.length === 0) return '[]'
    let out = '[ '
    for (let i = 0; i < node.items.length; i++) {
      const item = node.items[i]
      out += (i > 0 ? ', ' : '') + (item ? flowText(item) : 'null')
    }
    return out + ' ]'
  }
  if (node.kind === 'map') {
    if (node.items.length === 0) return '{}'
    let out = '{ '
    for (let i = 0; i < node.items.length; i++) {
      const pair = node.items[i]
      if (pair === undefined) continue
      out += (i > 0 ? ', ' : '') + flowText(pair.key) + ': ' + (pair.value ? flowText(pair.value) : 'null')
    }
    return out + ' }'
  }
  return flowText(node)
}

/**
 * Parses a block mapping whose entries sit at column `indent`.
 *
 * `firstKey` covers the one case the cursor cannot describe on its own: a
 * collection or alias written as an implicit key (`[a, b]: value`, `*ref: value`).
 * `parseNodeInner` has to parse that node before it can tell a key from a
 * document-level node, so it hands the finished one over here with the cursor
 * already past the `:`. It is consumed before the entry loop starts, which keeps
 * the loop — the hottest code in the parser — free of any test for it.
 *
 * `firstProps` carries the `&anchor` / `!tag` properties `parseNodeInner`
 * scanned off the head of the first key's line. They describe the *key*, not the
 * mapping that key opens, so they cannot be attached before the key exists —
 * which makes the entry loop their owner rather than the caller. Later entries
 * scan their own; only the first one's are already consumed by the time we
 * get here.
 */
const parseBlockMap = (
  state: State,
  indent: number,
  firstColon: number,
  firstKey: YamlNode | null = null,
  firstProps: NodeProps = NO_PROPS,
): YamlMap => {
  const { src, len } = state
  const items: YamlPair[] = []
  // Duplicate-key tracking; see `trackKey` for why small maps avoid the `Set`.
  let seen: Set<string> | null = null

  // The cursor is already parked at the first key's content; later iterations
  // re-derive the next entry's position with `peekLine` (which needs a line
  // start, an invariant the previous entry's value leaves us on).
  let contentPos = state.pos
  let firstEntry = true
  if (firstKey !== null) {
    // Consume the caller's already-parsed key here rather than inside the loop:
    // the loop body is the parser's hottest code, and this case would otherwise
    // add a test to every entry of every mapping to serve the first entry of a
    // rare one.
    const firstValue = parseValueOrChild(state, indent)
    if (state.uniqueKeys) seen = trackKey(state, items, firstKey, seen)
    items.push({
      kind: 'pair',
      key: firstKey,
      value: firstValue,
      start: firstKey.start,
      end: firstValue ? firstValue.end : firstKey.end,
    })
    firstEntry = false
  }
  for (;;) {
    let colon: number
    let explicit: boolean
    let keyProps: NodeProps
    if (firstEntry) {
      // `parseNode` already classified this line: a non-negative `firstColon` is
      // an inline `key:`; a negative one signals an explicit `?` introducer.
      colon = firstColon
      explicit = firstColon < 0
      keyProps = firstProps
    } else {
      const line = peekLine(state, indent)
      if (line.eof || line.indent !== indent) break
      const lineStart = state.pos
      contentPos = line.contentPos
      let c = src.charCodeAt(contentPos)
      // A `-` entry indicator at this indent is a sequence, not a mapping key.
      if (isSeqEntryDash(src, contentPos, len)) break
      keyProps = NO_PROPS
      // `&` and `!` cannot begin a plain scalar, so a key line that opens on one
      // is carrying node properties — and the key starts past them. Reading the
      // key's own text has to wait for that, and so does `findKeyColon`: an
      // anchor name may itself hold a `:` (`&a: key: value` anchors `key` as
      // `a:`), which the colon scan would otherwise mistake for the separator.
      // One character comparison per entry buys all of that; the scan itself
      // only ever runs for a key that really is annotated.
      if (c === AMP || c === BANG) {
        state.pos = contentPos
        keyProps = scanPropsSlow(state)
        skipInlineSpaces(state)
        contentPos = state.pos
        c = src.charCodeAt(contentPos)
      }
      // The `? ` introducer outranks any `: ` later on the line — see the same
      // ordering in `parseNodeInner`.
      explicit = c === QUESTION && introducerBoundary(src, contentPos + 1, len)
      colon = explicit ? -1 : findKeyColon(src, contentPos, len)
      if (colon < 0 && !explicit) {
        // Neither an inline `key:` nor a `? key`: the mapping ends here. Rewind
        // over any properties consumed above, so whatever ends it is reported at
        // the line it starts on rather than mid-line.
        state.pos = lineStart
        break
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
      key = attachProps(
        parseValueOrChild(state, indent, true) ?? {
          kind: 'scalar',
          value: null,
          source: '',
          style: 'plain',
          start: qStart + 1,
          end: qStart + 1,
        },
        keyProps,
        state,
      )
      const vline = peekLine(state, indent)
      if (
        !vline.eof &&
        vline.indent === indent &&
        src.charCodeAt(vline.contentPos) === COLON &&
        introducerBoundary(src, vline.contentPos + 1, len)
      ) {
        state.pos = vline.contentPos + 1
        value = parseValueOrChild(state, indent, true)
      }
    } else {
      const lineContentPos = contentPos
      if (colon - lineContentPos > MAX_IMPLICIT_KEY_LENGTH) reportLongImplicitKey(state, lineContentPos, colon)
      state.pos = contentPos
      const kc = src.charCodeAt(state.pos)
      if (kc === DQUOTE || kc === SQUOTE) {
        key = scanQuoted(state, kc)
        // A quoted key is the one key kind that can reach past its own line, and
        // `findKeyColon` follows it there — so this is where the one-line rule
        // for implicit keys has to be enforced. The `indexOf` runs on the key's
        // own text, which the scan just sliced.
        if (key.source.indexOf('\n') !== -1) {
          pushError(state, 'BAD_IMPLICIT_KEY', 'An implicit key must be on one line', key.start, key.end)
        }
      } else if (kc === STAR) {
        // `*ref: value` keys the mapping by the anchored value, so the key has to
        // be a real alias node — slicing it as text would key it by the literal
        // `*ref` and lose the reference.
        key = scanAlias(state)
      } else if (kc === LBRACKET || kc === LBRACE) {
        // `[a, b]: value` / `{x: 1}: value` — the key is a flow collection, and
        // like an alias it has to be parsed rather than sliced. As text it came
        // out as the plain scalar `[a, b]`, which loses every node inside it
        // (and their source positions) and renders the key differently from the
        // identical collection written as the mapping's *first* key, which has
        // always gone through `parseNodeInner` and been parsed properly.
        enterFlow(state, indent)
        key = kc === LBRACKET ? parseFlowSeq(state) : parseFlowMap(state)
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
      // Before the value, so a value that aliases the key it sits beside
      // (`&a a: *a`) finds the anchor already registered.
      key = attachProps(key, keyProps, state)

      state.pos = colon + 1
      skipInlineSpaces(state)

      if (atLineEnd(state)) {
        // Value lives on the following lines (or is empty).
        finishLine(state)
        const child = peekLine(state, indent + 1)
        if (!child.eof && child.indent > indent) {
          state.pos = child.contentPos
          value = parseNode(state, child.indent, indent)
        } else if (!child.eof && child.indent === indent) {
          if (isSeqEntryDash(src, child.contentPos, len)) {
            state.pos = child.contentPos
            value = parseBlockSeq(state, indent)
          }
        }
      } else {
        value = parseInlineValue(state, indent)
        finishLineIfMidLine(state)
      }
    }

    if (state.uniqueKeys) seen = trackKey(state, items, key, seen)
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
      const line = peekLine(state, indent)
      if (line.eof || line.indent !== indent) break
      contentPos = line.contentPos
    }
    firstEntry = false
    if (!isSeqEntryDash(src, contentPos, len)) break
    if (startOffset === -1) startOffset = contentPos

    const dashPos = contentPos
    state.pos = dashPos + 1
    // A `- ` entry may open a compact collection on its own line, so the
    // separation after the indicator is held to the indentation rule.
    skipIndicatorSeparation(state)

    let item: YamlNode
    // One character read serves both questions this line asks: whether the entry
    // has a value on it at all (the `atLineEnd` test, inlined here so the read is
    // not repeated), and whether that value opens a block scalar.
    const ic = src.charCodeAt(state.pos)
    if (state.pos >= len || ic === NL || ic === CR || ic === HASH) {
      finishLine(state)
      const child = peekLine(state, indent + 1)
      if (!child.eof && child.indent > indent) {
        state.pos = child.contentPos
        item = parseNode(state, child.indent, indent, false)
      } else {
        item = { kind: 'scalar', value: null, source: '', style: 'plain', start: dashPos + 1, end: dashPos + 1 }
      }
    } else {
      // A block scalar opened on the `- ` line measures its content against the
      // sequence's own indentation, not the column the `|`/`>` happens to land
      // on: `- |` at column 0 may hold content indented by one, which the item's
      // content column (2) would reject — dropping the scalar's body.
      item =
        ic === PIPE || ic === GT
          ? scanBlockScalar(state, indent)
          : parseNode(state, state.pos - contentPos + indent, indent, false)
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
 * Hard cap on parser nesting. Every collection level adds a couple of stack
 * frames, so this stays comfortably below the native limit while allowing far
 * deeper structures than any real document uses.
 */
const MAX_PARSE_DEPTH = 1000

/**
 * Parses a block node (mapping, sequence, or scalar) whose first token sits at
 * column `indent`. The cursor is assumed to be at that first token.
 *
 * `parentIndent` is the column the node's *own* continuation has to clear —
 * the indentation of the collection that holds it, which the spec calls `n`. It
 * is not `indent - 1`: a node need only be indented more than its parent, so it
 * can start several columns further in (`a:` / `⟨3 spaces⟩foo`) and still fold a
 * line that sits between the two. Assuming `indent - 1` cut every such document
 * short — a zero-indented sequence under a `key:` was orphaned, a plain scalar
 * stopped at the first line that stepped back, and a block scalar measured its
 * indentation indicator from the wrong column. Callers that genuinely are the
 * parent (the document root) pass -1.
 *
 * `seqAtParentIndent` says whether a block sequence written back at
 * `parentIndent` may be adopted as this node's content. That is the "a sequence
 * may sit at its mapping's own column" allowance, and it holds only where the
 * parent really is a *mapping*. A block sequence entry passes `false`: under a
 * `-`, a dash back at the sequence's own column is the next sibling entry, and
 * reading it as nested content swallowed every entry after it.
 */
const parseNode = (state: State, indent: number, parentIndent: number, seqAtParentIndent = true): YamlNode => {
  if (state.depth >= MAX_PARSE_DEPTH) {
    const pos = state.pos
    pushError(state, 'DEPTH_LIMIT', `Exceeded maximum nesting depth of ${MAX_PARSE_DEPTH}`, pos, pos)
    // Consume the remaining input so every enclosing collection loop sees EOF and
    // stops instead of spinning on the un-advanced position.
    state.pos = state.len
    return { kind: 'scalar', value: null, source: '', style: 'plain', start: pos, end: pos }
  }
  state.depth++
  const node = parseNodeInner(state, indent, parentIndent, seqAtParentIndent)
  state.depth--
  return node
}

const parseNodeInner = (state: State, indent: number, parentIndent: number, seqAtParentIndent: boolean): YamlNode => {
  const { src, len } = state
  if (isSeqEntryDash(src, state.pos, len)) {
    return parseBlockSeq(state, indent)
  }

  const props = scanProps(state)
  if (props.anchor || props.tag) {
    skipInlineSpaces(state)
    // A block sequence cannot start on the line that carries its properties:
    // its entries are indentation-relative and there is no column for the
    // second one to sit at. Without the report `&a - x` read as the plain
    // scalar `"- x"`, quietly turning a sequence into a string.
    if (isSeqEntryDash(src, state.pos, len)) {
      pushError(
        state,
        'UNEXPECTED_CONTENT',
        'A block sequence cannot start on the line its node properties are written on',
        state.pos,
        state.pos + 1,
      )
    }
    if (atLineEnd(state)) {
      finishLine(state)
      const child = peekLine(state, parentIndent + 1)
      // Properties may sit on a line of their own, with the node they describe
      // below them. What the node has to clear is the *parent's* indentation,
      // not the property line's own column — the two are usually equal (`e:` /
      // `&node` / `- x: y` all at one level), but a `seq:` whose `&anchor` sits
      // one column in and whose entries then return to column 0 is legal, and
      // measuring against the anchor's column orphaned the whole sequence.
      if (!child.eof && child.indent > parentIndent) {
        state.pos = child.contentPos
        return attachProps(parseNode(state, child.indent, parentIndent, seqAtParentIndent), props, state)
      }
      // …and a block sequence may return to the parent's own column, which is
      // the only shape that reaches back this far. See `parsePropsOnlyValue`,
      // which the sibling spelling (`seq: &anchor`) goes through. Only a
      // *mapping* parent allows it — inside a sequence a dash at that column is
      // the next entry, which `seqAtParentIndent` is here to keep us off.
      if (
        seqAtParentIndent &&
        !child.eof &&
        child.indent === parentIndent &&
        isSeqEntryDash(src, child.contentPos, len)
      ) {
        state.pos = child.contentPos
        return attachProps(parseBlockSeq(state, parentIndent), props, state)
      }
      return attachProps(
        { kind: 'scalar', value: null, source: '', style: 'plain', start: state.pos, end: state.pos },
        props,
        state,
      )
    }
  }

  const cc = src.charCodeAt(state.pos)
  // An alias or a flow collection at the head of a line may be the whole node —
  // or the *key* of a block mapping (`*ref: value`, `[a, b]: value`). Nothing
  // before the node ends distinguishes the two, so the `:` test happens after
  // it is parsed; until it did, the trailing `: value` and every sibling entry
  // of that mapping were silently discarded.
  if (cc === STAR || cc === LBRACKET || cc === LBRACE) {
    if (cc !== STAR) enterFlow(state, parentIndent)
    const node = attachProps(
      cc === STAR ? scanAlias(state) : cc === LBRACKET ? parseFlowSeq(state) : parseFlowMap(state),
      props,
      state,
    )
    skipInlineSpaces(state)
    if (src.charCodeAt(state.pos) === COLON && introducerBoundary(src, state.pos + 1, len)) {
      // The collection is this mapping's key, so it is an implicit key and has
      // to have fit on one line — `[23\n]: 42` does not.
      if (crossesLine(src, node.start, node.end)) {
        pushError(state, 'BAD_IMPLICIT_KEY', 'An implicit key must be on one line', node.start, node.end)
      }
      state.pos++
      return parseBlockMap(state, indent, -1, node)
    }
    checkTrailingContent(state)
    return node
  }
  // A block scalar's explicit indentation indicator counts from the parent's
  // indentation (`c-l+literal(n)` holds `l-literal-content(n+m,t)`). At the
  // document root the parent is -1 — `l-bare-document ::= s-l+block-node(-1,
  // block-in)` — so a root `|2` keeps one leading space of its two-space
  // content, and so does `--- |2`. `yaml` (eemeli) strips both; `js-yaml` agrees
  // with us, the spec reads our way, and the yaml-test-suite pins neither.
  // Deliberate, and pinned by tests in `parse-features.test.ts` so it cannot
  // drift silently.
  if (cc === PIPE || cc === GT) return attachProps(scanBlockScalar(state, parentIndent), props, state)

  // An explicit `? ` introducer is settled by the first two characters, so it
  // outranks any `: ` further along the line: `? earth: blue` is an explicit key
  // holding a compact mapping, not a key called `? earth`. Testing the colon
  // first read the `?` as ordinary text and folded the rest of the entry in
  // after it.
  if (cc === QUESTION && introducerBoundary(src, state.pos + 1, len)) {
    return attachProps(parseBlockMap(state, indent, -1), props, state)
  }
  // A line beginning with a quote may be a quoted *key* (e.g. `"200":`), so the
  // mapping check has to come before treating the quote as a standalone scalar.
  const colon = findKeyColon(src, state.pos, len)
  // Properties written on the same line as the first key belong to that key, not
  // to the mapping it opens — `&a a: b` anchors the scalar `a`, so a later `*a`
  // is the string `"a"` and not the whole map. (Properties on a line of their own
  // above the mapping *do* describe the mapping; that path returned above.)
  if (colon >= 0) return parseBlockMap(state, indent, colon, null, props)
  if (cc === DQUOTE || cc === SQUOTE) {
    const quoted = attachProps(scanQuoted(state, cc, parentIndent), props, state)
    checkTrailingContent(state)
    return quoted
  }
  if (isReservedIndicator(cc)) reportReservedIndicator(state)
  return attachProps(scanPlainScalar(state, parentIndent), props, state)
}

/**
 * Steps past a `---` marker at `p`, stopping on the node written on the marker
 * line when there is one. Returns that node's offset, or -1 when the line holds
 * nothing but the marker and an optional comment (the cursor is then parked at
 * the next line, as before).
 *
 * A document root may be written on the marker line — `--- foo`, `--- |`,
 * `--- !tag`, `--- "spanning` — and skipping straight to the next line dropped
 * it: `--- |` lost its block-scalar indicator and re-read the body as a folded
 * plain scalar, and `--- foo` lost the scalar entirely.
 */
const docMarkerInlineNode = (state: State, p: number): number => {
  const { src, len } = state
  let i = p + 3
  while (i < len && isSpace(src.charCodeAt(i))) i++
  const c = src.charCodeAt(i)
  if (i >= len || c === NL || c === CR || c === HASH) {
    state.pos = nextLineStart(src, i, len)
    return -1
  }
  state.pos = i
  return i
}

/**
 * Parses the node written on a `---` line. The node is the document root, so it
 * is measured against column 0 whatever column the marker pushed it to —
 * `--- |` holds a block scalar whose content may start at column 0.
 */
const parseDocMarkerNode = (state: State, contentPos: number): YamlNode => {
  const { src, len } = state
  // A *block* mapping is the one node kind that may not start here: its
  // following entries would have to align under a key at column 4 or beyond,
  // which the spec does not allow a document's root mapping to do. A flow
  // collection is fine on its own (`--- {a: 1}`), and `findKeyColon` now steps
  // over one before looking for the separator — so it can tell `--- [a, b]`
  // from the block mapping `--- [a, b]: v`, which this used to wave through.
  if (findKeyColon(src, contentPos, len) >= 0) {
    pushError(
      state,
      'UNEXPECTED_CONTENT',
      'A block mapping cannot start on the "---" line',
      contentPos,
      plainLineEnd(src, contentPos, len),
    )
  }
  state.pos = contentPos
  return parseNode(state, 0, -1)
}

/**
 * Reads a leading BOM, `%`-directives, and a `---` document-start marker.
 * Returns the offset of a node written on the marker line, or -1 when there is
 * none — see {@link docMarkerInlineNode}.
 */
const skipDocumentHead = (state: State): number => {
  const { src, len } = state
  if (src.charCodeAt(0) === 0xfeff) state.pos = 1
  for (;;) {
    const line = peekLine(state, 0)
    if (line.eof) return -1
    const c = src.charCodeAt(line.contentPos)
    if (c === PERCENT) {
      readDirective(state, line.contentPos)
      state.pos = nextLineStart(src, line.contentPos, len)
      continue
    }
    if (
      c === DASH &&
      src.charCodeAt(line.contentPos + 1) === DASH &&
      src.charCodeAt(line.contentPos + 2) === DASH &&
      (line.contentPos + 3 >= len ||
        isSpace(src.charCodeAt(line.contentPos + 3)) ||
        src.charCodeAt(line.contentPos + 3) === NL ||
        // CRLF input parks a `\r` right after `---`; without this the marker is
        // misread as a plain scalar. `isDocMarker` (stream path) already accepts
        // CR, so this keeps the two marker detectors in agreement.
        src.charCodeAt(line.contentPos + 3) === CR)
    ) {
      const inline = docMarkerInlineNode(state, line.contentPos)
      if (inline >= 0) return inline
      continue
    }
    return -1
  }
}

/**
 * Decodes a `!!binary` base64 payload to bytes without a dependency. `atob`
 * handles the decode; surrounding whitespace (block scalars wrap base64 across
 * lines) is stripped first. Returns `null` on malformed input so the caller can
 * fall back to the raw value rather than throw.
 */
const decodeBase64 = (text: string): Uint8Array | null => {
  try {
    const binary = atob(text.replace(/\s+/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/**
 * Coerces a scalar's value to honor a `!!`-style tag. Reached only when a scalar
 * actually carries a tag (rare), so the untagged hot path pays just one
 * `node.tag !== undefined` check. Beyond the core schema (`str`/`int`/`float`/
 * `bool`/`null`) we honor the common extended tags `binary` (→ bytes) and
 * `timestamp` (→ `Date`), matching `yaml` (eemeli). Note this is *explicit*
 * coercion only: an untagged ISO string still resolves to a string, so the
 * implicit-timestamp surprise that makes a JSON superset lossy never happens.
 * Unknown/custom tags pass through with the value unchanged — the tag stays on
 * the node for callers that want it.
 */
const applyScalarTag = (node: YamlScalar): unknown => {
  const v = node.value
  switch (node.tag) {
    case 'binary': {
      const bytes = decodeBase64(typeof v === 'string' ? v : node.source)
      return bytes ?? v
    }
    case 'timestamp': {
      const date = new Date((typeof v === 'string' ? v : node.source).trim())
      return Number.isNaN(date.getTime()) ? v : date
    }
    // The bare `!` is the non-specific tag: it says "this node's type is not the
    // one resolution would infer", which for a scalar means the failsafe `!!str`.
    case '!':
    case 'str':
      // For a single-line plain scalar the raw source *is* the string (so
      // `!!str 1.50` keeps its trailing zero). A plain scalar that wraps is the
      // exception: its source still holds the raw line breaks, while `value`
      // holds the folded text the document actually means, so `!!str` over two
      // lines must read the folded value rather than un-fold it.
      return node.style === 'plain' && node.source.indexOf('\n') === -1
        ? node.source
        : typeof v === 'string'
          ? v
          : v === null
            ? ''
            : String(v)
    case 'null':
      return null
    case 'bool': {
      // For a quoted/block scalar the resolved value is the string content; for a
      // plain scalar fall back to the raw source. Either way `!!bool "true"` must
      // become `true`, matching how `int`/`float`/`str` read tagged scalars.
      const s = typeof v === 'string' ? v : node.source
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

/**
 * Tracks how many nodes an alias-expanding projection is still allowed to
 * materialize. Aliases are re-expanded into fresh values, so a document like
 * `a: &x [*w,*w], b: &y [*x,*x], …` grows the output exponentially from a tiny
 * source — the classic "billion laughs" resource-exhaustion attack. Every
 * materialized node decrements the budget; hitting zero throws instead of
 * hanging, matching how eemeli's `yaml` guards `maxAliasCount`.
 */
type ExpansionBudget = { left: number }

/**
 * Assigns `value` under `key` on a projected mapping. A plain `obj[key] = value`
 * would invoke the prototype setter for a `__proto__` key and corrupt the
 * object's prototype (prototype pollution from an untrusted document); defining
 * it as an own data property keeps it a normal key, as eemeli's `yaml` does.
 */
const setMapKey = (obj: Record<string, unknown>, key: string, value: unknown): void => {
  if (key === '__proto__') {
    Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true })
  } else {
    obj[key] = value
  }
}

/**
 * Nodes an alias-free document may materialize per source byte, plus a floor for
 * small documents. Only exponential alias expansion exceeds this — an ordinary
 * document has at most ~one node per few source bytes.
 */
const ALIAS_NODES_PER_BYTE = 100
const MIN_ALIAS_NODE_BUDGET = 100_000

const newExpansionBudget = (sourceLength: number): ExpansionBudget => ({
  left: Math.max(MIN_ALIAS_NODE_BUDGET, sourceLength * ALIAS_NODES_PER_BYTE),
})

/**
 * Cap on recursion depth while *projecting* the tree to JS, distinct from the
 * parser's {@link MAX_PARSE_DEPTH}. The parser bounds structural nesting, but
 * aliases are re-expanded here: an alias defined at shallow parse depth can
 * point at a deeply-nested node, and a chain of such aliases makes the expanded
 * traversal far deeper than the parse tree while keeping the node count under
 * {@link ExpansionBudget} (each node is visited once per expansion). Without a
 * separate limit that chain recurses straight into the native stack ceiling,
 * turning a small untrusted document into an uncatchable `RangeError` crash.
 * Set to twice the parse cap so ordinary alias reuse (embedding a shared,
 * deeply-nested subtree) still projects, while a runaway chain throws the same
 * catchable resource-exhaustion error the budget does.
 */
const MAX_PROJECT_DEPTH = MAX_PARSE_DEPTH * 2

const toJsValue = (node: YamlNode | null, merge: boolean, budget: ExpansionBudget, depth: number): unknown => {
  if (budget.left-- <= 0) {
    throw new Error('Excessive alias expansion — the document may be a resource-exhaustion attack')
  }
  if (depth > MAX_PROJECT_DEPTH) {
    throw new Error('Excessive nesting depth — the document may be a resource-exhaustion attack')
  }
  if (node === null) return null
  if (node.kind === 'scalar') return node.tag !== undefined ? applyScalarTag(node) : node.value
  if (node.kind === 'alias') {
    // `target` was captured at parse time as the anchor in scope where the alias
    // appeared, so a later redefinition of the same name doesn't affect it.
    return node.target ? toJsValue(node.target, merge, budget, depth + 1) : undefined
  }
  if (node.kind === 'seq') {
    // Index loop into a pre-sized array: no per-seq closure (as `.map` allocates)
    // and the result array never reallocates as it grows.
    const items = node.items
    const out = new Array(items.length)
    for (let i = 0; i < items.length; i++) out[i] = toJsValue(items[i] ?? null, merge, budget, depth + 1)
    // `!!omap` is an ordered map written as a sequence of single-pair maps;
    // collapse it to a `Map` to match `yaml` (eemeli). One `=== 'omap'` check
    // per sequence keeps the untagged path effectively free.
    if (node.tag === 'omap') return toOmap(out)
    return out
  }

  const obj: Record<string, unknown> = {}
  const items = node.items
  for (let i = 0; i < items.length; i++) {
    const pair = items[i]
    if (pair === undefined) continue
    const key = pair.key
    if (merge && key.kind === 'scalar' && key.source === '<<') {
      applyMerge(obj, toJsValue(pair.value, merge, budget, depth + 1))
      continue
    }
    setMapKey(obj, keyText(key), pair.value ? toJsValue(pair.value, merge, budget, depth + 1) : null)
  }
  // `!!set` is a mapping whose keys are the members; project to a `Set`.
  if (node.tag === 'set') {
    const set = new Set<unknown>()
    for (let i = 0; i < items.length; i++) {
      const pair = items[i]
      if (pair) set.add(toJsValue(pair.key, merge, budget, depth + 1))
    }
    return set
  }
  return obj
}

/** Folds a `!!omap` sequence (single-pair maps) into an ordered `Map`. */
const toOmap = (items: unknown[]): Map<unknown, unknown> => {
  const map = new Map<unknown, unknown>()
  for (const item of items) {
    if (item && typeof item === 'object') {
      for (const [k, value] of Object.entries(item)) map.set(k, value)
    }
  }
  return map
}

/** Folds a `<<` merge value (a map or list of maps) into `target` without overriding existing keys. */
const applyMerge = (target: Record<string, unknown>, value: unknown): void => {
  if (Array.isArray(value)) {
    for (const entry of value) applyMerge(target, entry)
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      // `k in target` walks the prototype chain, so every `Object.prototype`
      // member — `toString`, `valueOf`, `constructor`, `hasOwnProperty`,
      // `__proto__`, … — looked like a key the target already had and was
      // silently dropped from the merge, with no diagnostic. Only *own* keys
      // may shadow a merged one. This stays pollution-safe because `setMapKey`
      // still defines `__proto__` as a plain data property rather than
      // assigning through the prototype setter.
      if (!Object.hasOwn(target, k)) setMapKey(target, k, v)
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
  tabReportedAt: -1,
  depth: 0,
  tagHandles: null,
  yamlDirective: false,
  flowIndent: -1,
  flowIndentReported: false,
  line: { eof: false, indent: 0, contentPos: 0 },
})

/**
 * Reports a second root node in what should be a single document — `a: 1` and
 * `b: 2` followed by a bare `[1, 2]` at column 0, which the block parsers stop
 * before and would otherwise leave silently unparsed. A `---`/`...` marker is
 * the legitimate way to follow one node with another, so those end the check.
 *
 * A document whose root is a block collection ends with the cursor already at
 * end of input — the collection loop only stops when `peekLine` reports EOF — so
 * the usual case costs one comparison and nothing else.
 */
const checkDocumentEnd = (state: State): void => {
  if (state.pos >= state.len) return
  finishLineIfMidLine(state)
  const line = peekLine(state, 0)
  if (line.eof) return
  const c = state.src.charCodeAt(line.contentPos)
  if ((c === DASH || c === DOT) && isDocMarker(state.src, line.contentPos, state.len)) {
    warnIfMoreDocuments(state, line.contentPos)
    return
  }
  pushError(
    state,
    'UNEXPECTED_CONTENT',
    'Unexpected content after the document node — start a new document with "---"',
    line.contentPos,
    plainLineEnd(state.src, line.contentPos, state.len),
  )
}

/**
 * Warns when a `---`/`...` marker has another document under it.
 *
 * Reading only the first document of a stream is deliberate and documented, but
 * a caller on `parse()` only ever sees the data — truncated input is
 * indistinguishable from a document that genuinely held those keys alone, which
 * is silent data loss for anyone who did not read the docs first. A bare
 * trailing marker (`a: 1\n...\n`) closes the stream without hiding anything, so
 * we look past it and only warn when real content follows.
 *
 * Advancing `state.pos` here is safe: `checkDocumentEnd` is the last thing
 * `parseDocument` does with the cursor.
 */
const warnIfMoreDocuments = (state: State, markerPos: number): void => {
  state.pos = nextLineStart(state.src, markerPos + 3, state.len)
  if (peekLine(state, 0).eof) return
  pushWarning(
    state,
    'MULTIPLE_DOCUMENTS',
    'Only the first document of this stream was parsed — use parseAllDocuments to read the rest',
    markerPos,
    markerPos + 3,
  )
}

/** Builds a document from the current `state`, closing over its problems. */
const finishDocument = (state: State, contents: YamlNode | null): YamlDocument => {
  const { errors, warnings, merge, len } = state
  // Aliases carry their resolved target (captured at parse time), so projection
  // no longer needs the anchors map — anchor scope is settled by the time we get here.
  return { contents, errors, warnings, toJS: () => toJsValue(contents, merge, newExpansionBudget(len), 0) }
}

/**
 * Parses a YAML document into a node tree with source ranges, collected
 * problems, and a lazy `toJS` projection. Only the first document of a stream is
 * read; use {@link parseAllDocuments} for multi-document (`---`-separated) input.
 */
export const parseDocument = (source: string, options: ParseOptions = {}): YamlDocument => {
  const state = newState(source, options)
  const inline = skipDocumentHead(state)
  let contents: YamlNode | null = null
  if (inline >= 0) {
    contents = parseDocMarkerNode(state, inline)
    checkDocumentEnd(state)
    return finishDocument(state, contents)
  }
  const head = peekLine(state, 0)
  if (!head.eof) {
    // Stop a bare `...` document-end marker from being read as a scalar.
    const c = source.charCodeAt(head.contentPos)
    const isDocEnd =
      c === 46 /* . */ && source.charCodeAt(head.contentPos + 1) === 46 && source.charCodeAt(head.contentPos + 2) === 46
    if (!isDocEnd) {
      state.pos = head.contentPos
      contents = parseNode(state, head.indent, -1)
      checkDocumentEnd(state)
    }
  }
  return finishDocument(state, contents)
}

/** `skipStreamHead` result bits: which document markers it consumed. */
const SAW_DOC_START = 1
const SAW_DOC_END = 2
/**
 * The `---` it consumed carried the document's root node on the same line, and
 * `state.pos` is parked on that node rather than at the next line start.
 */
const SAW_INLINE_NODE = 4

/**
 * Consumes the head of one document in a stream — any `%`-directives, `...`
 * end markers of a preceding document, and a single `---` start marker.
 *
 * Returns a bitmask of what it saw. `---` marks an explicit (possibly empty)
 * document even when no body follows; `...` matters because it closes the
 * previous document, which makes the next one legal without a `---` of its own.
 */
const skipStreamHead = (state: State, closed: boolean): number => {
  const { src, len } = state
  let seen = 0
  let sawDirective = false
  for (;;) {
    const line = peekLine(state, 0)
    if (line.eof) break
    const p = line.contentPos
    const c = src.charCodeAt(p)
    if (c === PERCENT) {
      // A directive belongs to the document that follows it, so it may only
      // appear at the start of the stream or once the previous document has
      // been closed by a `...` footer.
      if (!closed && (seen & SAW_DOC_END) === 0) {
        pushError(
          state,
          'UNEXPECTED_DIRECTIVE',
          'A directive must be preceded by a "..." document-end marker',
          p,
          tokenEnd(src, p, len),
        )
      }
      readDirective(state, p)
      sawDirective = true
      state.pos = nextLineStart(src, p, len)
      continue
    }
    if (c === DOT && isDocMarker(src, p, len)) {
      let after = p + 3
      while (after < len && isSpace(src.charCodeAt(after))) after++
      const trailing = src.charCodeAt(after)
      if (after < len && trailing !== NL && trailing !== CR && trailing !== HASH) {
        pushError(
          state,
          'UNEXPECTED_CONTENT',
          'Unexpected content after the "..." document-end marker',
          after,
          plainLineEnd(src, after, len),
        )
      }
      state.pos = nextLineStart(src, p + 3, len)
      seen |= SAW_DOC_END
      continue
    }
    if (c === DASH && isDocMarker(src, p, len)) {
      const inline = docMarkerInlineNode(state, p)
      return inline >= 0 ? seen | SAW_DOC_START | SAW_INLINE_NODE : seen | SAW_DOC_START
    }
    break
  }
  // Falling out here means no `---` followed, so the directives describe a
  // document that was never written.
  if (sawDirective) {
    pushError(
      state,
      'UNEXPECTED_DIRECTIVE',
      'A directive must be followed by a "---" document start',
      state.pos,
      state.pos,
    )
  }
  return seen
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
  // Whether the stream is currently between documents — true before the first
  // one, and again after a `...` footer. Only then may directives appear.
  let closed = true
  for (;;) {
    const markers = skipStreamHead(state, closed)
    const sawStart = (markers & SAW_DOC_START) !== 0
    let contents: YamlNode | null = null
    let bodyConsumed = false
    /** A `...` consumed as this (empty) document's own footer, which closes it. */
    let footer = false
    if ((markers & SAW_INLINE_NODE) !== 0) {
      // The root node is written on the `---` line; the cursor already sits on it.
      contents = parseDocMarkerNode(state, state.pos)
      finishLineIfMidLine(state)
      bodyConsumed = true
    }
    if (!bodyConsumed) {
      const line = peekLine(state, 0)
      if (!line.eof) {
        const p = line.contentPos
        const c = src.charCodeAt(p)
        if (c === DASH && isDocMarker(src, p, len)) {
          // The next document's start marker: the current document is empty. Leave
          // the marker for the next iteration's `skipStreamHead` to consume.
        } else if (c === DOT && isDocMarker(src, p, len)) {
          // A `...` end marker terminates this (empty) document; consume it.
          state.pos = nextLineStart(src, p + 3, len)
          footer = true
        } else {
          // A second document may follow the first bare, but only once the one
          // before it was closed — by its own `---` or by a `...` end marker.
          // Otherwise this is stray content, not a new document.
          if (!sawStart && (markers & SAW_DOC_END) === 0 && docs.length > 0) {
            pushError(
              state,
              'UNEXPECTED_CONTENT',
              'Unexpected content — start a new document with "---"',
              p,
              plainLineEnd(src, p, len),
            )
          }
          // `%` is an indicator, so it cannot open a node: a document body that
          // starts with one is a directive written where it does not belong.
          if (c === PERCENT) {
            pushError(
              state,
              'UNEXPECTED_DIRECTIVE',
              'A directive must be preceded by a "..." document-end marker',
              p,
              tokenEnd(src, p, len),
            )
          }
          state.pos = p
          contents = parseNode(state, line.indent, -1)
          finishLineIfMidLine(state)
          bodyConsumed = true
        }
      }
    }
    if (!sawStart && !bodyConsumed) break
    docs.push(finishDocument(state, contents))
    closed = footer
    state.errors = []
    state.warnings = []
    state.anchors = new Map()
    state.tagHandles = null
    state.yamlDirective = false
  }
  // Diagnostics raised after the last document was finished — a malformed `...`
  // footer, a directive that no `---` ever followed — belong to the stream, not
  // to nothing. Without this they are reported into an array no caller holds.
  if (state.errors.length > 0 || state.warnings.length > 0) {
    const tail = docs[docs.length - 1]
    if (tail === undefined) docs.push(finishDocument(state, null))
    else {
      tail.errors.push(...state.errors)
      tail.warnings.push(...state.warnings)
    }
  }
  return docs
}
