import { isAlias, isMap, isScalar, isSeq, parseDocument, type YamlNode, type YamlSeq } from '@amritk/yaml'
import { applyEdits, findNodeAtLocation, modify, type Node, parseTree } from 'jsonc-parser'

import type { ParserFormat } from './index'
import type { JsonPath } from './types'

/**
 * A single structural edit against a parsed document, expressed in terms of JSON
 * paths and values rather than raw character offsets. {@link applyEditOps} lowers
 * each op to a minimal text edit so that untouched parts of the source — including
 * comments, key order, and quoting — keep their original formatting.
 *
 * A few edits are deliberately conservative no-ops rather than risky rewrites:
 *
 * - Edits that traverse a YAML alias (`*ref`) or a `<<` merge key resolve to a
 *   node the edit model cannot address structurally, so they are dropped. This is
 *   safe — the source is left untouched — but it does mean a finding on data that
 *   only exists via an alias/merge is not auto-fixed.
 * - `setValue` on an *anchored* node (`&anchor`) rewrites the anchor's own text,
 *   which every `*alias` to it re-reads; the change therefore propagates to every
 *   alias use-site. That is the correct YAML semantics, but callers should be
 *   aware the edit is not local to one path.
 * - Multi-line *flow* collections (`[\n  a,\n  b\n]`) are rebuilt onto a single
 *   line by {@link rewriteYamlSeq} and the flow-map insert, and any comments that
 *   lived between their members are dropped. Block collections keep their layout
 *   and comments; only flow ones are collapsed.
 */
export type EditOp =
  /** Replace the scalar value at `path` (the existing quoting style is preserved). */
  | { op: 'setValue'; path: JsonPath; value: unknown }
  /** Remove the object property at `path` (the last segment is the key). */
  | { op: 'removeProperty'; path: JsonPath }
  /** Rename the object property at `path` (the last segment is the current key). */
  | { op: 'renameProperty'; path: JsonPath; newKey: string }
  /** Remove the listed array indices from the array at `path`. */
  | { op: 'removeItems'; path: JsonPath; indices: number[] }
  /** Reorder the array at `path`; `order` lists the original indices in their new order. */
  | { op: 'reorderArray'; path: JsonPath; order: number[] }
  /** Add a `key: value` property to the object at `path` (a no-op when the key already exists). */
  | { op: 'insertProperty'; path: JsonPath; key: string; value: unknown }
  /** Insert `value` into the array at `path` at `index` (appended when `index` is omitted). */
  | { op: 'insertItem'; path: JsonPath; value: unknown; index?: number }

const splice = (text: string, start: number, end: number, replacement: string): string =>
  text.slice(0, start) + replacement + text.slice(end)

/** The offset of the start of the line containing `offset`. */
const lineStart = (text: string, offset: number): number => {
  let s = offset
  while (s > 0 && text.charCodeAt(s - 1) !== 10) s--
  return s
}

/** Expands `[start, end)` to cover whole lines: back to the line start, forward past the trailing newline. */
const expandLine = (text: string, start: number, end: number): [number, number] => {
  const s = lineStart(text, start)
  let e = end
  while (e < text.length && text.charCodeAt(e) !== 10) e++
  if (e < text.length) e++
  return [s, e]
}

/**
 * The document's dominant line ending. We look at the first break so inserted
 * lines match the file rather than always emitting a bare `\n` (which would leave
 * a CRLF file with mixed endings).
 */
const detectEol = (text: string): string => {
  const i = text.indexOf('\n')
  return i > 0 && text.charCodeAt(i - 1) === 13 ? '\r\n' : '\n'
}

// --- YAML ------------------------------------------------------------------

/**
 * Stringifies a key the way `toJS` does, so the paths we address by match the
 * keys the projected data exposes: a null key is `null`, a bool/number key is its
 * `String()` form, an alias key is `*name`, and a complex (map/seq) key is empty.
 */
const keyName = (key: unknown): string => {
  if (isScalar(key)) {
    const v = key.value
    return typeof v === 'string' ? v : v === null ? 'null' : String(v)
  }
  if (isAlias(key)) return `*${key.source}`
  if (isMap(key) || isSeq(key)) return ''
  return String(key)
}

/** Navigates the YAML CST to the node at `path`, or `undefined` if absent. */
const yamlNodeAt = (root: YamlNode | null, path: JsonPath): YamlNode | undefined => {
  let current: YamlNode | undefined = root ?? undefined
  for (const segment of path) {
    if (current === undefined) return undefined
    if (isMap(current)) {
      const target = String(segment)
      // Last-wins: duplicate keys resolve to the final occurrence, matching how
      // `toJS` and the position index treat them, so an edit is not a silent no-op
      // that lands on a shadowed earlier copy.
      const pair = current.items.findLast((item) => keyName(item.key) === target)
      current = pair?.value ?? undefined
    } else if (isSeq(current)) {
      current = current.items[Number(segment)]
    } else {
      return undefined
    }
  }
  return current
}

/** Resolves the key/value CST nodes of the property at `path` (last segment = key). */
const yamlPairAt = (root: YamlNode | null, path: JsonPath): { key?: YamlNode; value?: YamlNode } => {
  const parent = yamlNodeAt(root, path.slice(0, -1))
  if (!parent || !isMap(parent)) return {}
  const last = String(path[path.length - 1])
  const pair = parent.items.findLast((item) => keyName(item.key) === last)
  if (!pair) return {}
  return { key: pair.key, ...(pair.value ? { value: pair.value } : {}) }
}

/**
 * Checks that writing `plain` bare into YAML round-trips back to the string
 * `value`. A bare scalar can silently change meaning — `true` becomes a boolean,
 * `1.0` a number, an empty string a null — and text carrying `: ` or ` #` or a
 * newline reshapes the line, so we parse the candidate on its own and require it
 * to come back as exactly the same string before trusting it unquoted.
 */
const plainStringRoundTrips = (plain: string, value: string): boolean => {
  const doc = parseDocument(plain)
  return doc.errors.length === 0 && isScalar(doc.contents) && doc.contents.value === value
}

// Keys made only of these characters are safe to write bare in YAML; anything
// else (spaces, colons, flow indicators) gets double-quoted to stay valid.
const SAFE_YAML_KEY = /^[\w./-]+$/

/** Serializes a scalar, preserving the quoting style of the value it replaces. */
const yamlScalar = (value: unknown, original: string): string => {
  if (typeof value !== 'string') return value === null ? 'null' : String(value)
  const quote = original.charCodeAt(0)
  if (quote === 34 /* " */) return JSON.stringify(value)
  if (quote === 39 /* ' */) return `'${value.replace(/'/g, "''")}'`
  // Plain (unquoted) original: keep it bare only when the bare text still means
  // this exact string; otherwise fall back to a double-quoted literal so we never
  // turn a string into a bool/number/null or corrupt the line.
  return plainStringRoundTrips(value, value) ? value : JSON.stringify(value)
}

const yamlKey = (key: string, original: string): string => {
  const quote = original.charCodeAt(0)
  if (quote === 34) return JSON.stringify(key)
  if (quote === 39) return `'${key.replace(/'/g, "''")}'`
  // A plain key that would resolve to a non-string (e.g. `true`, `1.0`) or is not
  // otherwise safe bare gets quoted, matching the value-side treatment.
  return SAFE_YAML_KEY.test(key) && plainStringRoundTrips(key, key) ? key : JSON.stringify(key)
}

/** Serializes a key for an inserted property, quoting it only when it needs to be. */
const yamlInsertKey = (key: string): string => (SAFE_YAML_KEY.test(key) ? key : JSON.stringify(key))

/**
 * Serializes a value for insertion. YAML is a JSON superset, so JSON output is
 * always valid YAML: scalars become bare literals (`42`, `true`, `"text"`) and
 * objects/arrays become inline flow (`{"a":1}`). That keeps the inserted node on
 * one line without us having to re-implement a block serializer.
 */
const yamlInsertValue = (value: unknown): string => JSON.stringify(value) ?? 'null'

/** Serializes a fresh scalar (no original to mirror), quoting strings only when bare would change meaning. */
const yamlFreshScalar = (value: unknown): string => {
  if (value !== null && typeof value === 'object') return yamlInsertValue(value)
  if (typeof value === 'string') return plainStringRoundTrips(value, value) ? value : JSON.stringify(value)
  return value === null ? 'null' : String(value)
}

/** Returns the leading whitespace of the line containing `offset` (its indentation). */
const lineIndent = (text: string, offset: number): string => {
  const start = lineStart(text, offset)
  let end = start
  while (end < text.length && (text.charCodeAt(end) === 32 || text.charCodeAt(end) === 9)) end++
  return text.slice(start, end)
}

/**
 * The indentation a new block-sequence item should carry, measured from the
 * column of the first item's own `- ` dash. Using the dash column (not the line's
 * leading whitespace) keeps a nested sequence correct: for `- - 1` the inner
 * item's dash sits at column 2, so a new inner item indents to match it rather
 * than appending to the outer sequence.
 */
const seqItemIndent = (text: string, firstItem: YamlNode): string => {
  const start = lineStart(text, firstItem.start)
  let dash = firstItem.start - 1
  while (dash > start && text.charCodeAt(dash) !== 45 /* - */) dash--
  return text.charCodeAt(dash) === 45 ? ' '.repeat(dash - start) : lineIndent(text, firstItem.start)
}

const applyYamlOp = (text: string, op: EditOp): string => {
  const root = parseDocument(text).contents as YamlNode | null
  const eol = detectEol(text)
  switch (op.op) {
    case 'setValue': {
      const node = yamlNodeAt(root, op.path)
      if (!node) {
        // The target may be an explicit-empty key (`key:` with a null value). The
        // value node does not exist yet, so splice a scalar in right after the
        // colon rather than silently doing nothing.
        const { key, value } = yamlPairAt(root, op.path)
        if (key && value === undefined) {
          const colon = text.indexOf(':', key.end)
          if (colon !== -1) return splice(text, colon + 1, colon + 1, ` ${yamlFreshScalar(op.value)}`)
        }
        return text
      }
      // Scalars keep the node's original quoting; objects/arrays are written as
      // inline flow JSON (valid YAML) so a scalar can be widened to a collection.
      const replacement =
        op.value !== null && typeof op.value === 'object'
          ? yamlInsertValue(op.value)
          : yamlScalar(op.value, text.slice(node.start, node.end))
      return splice(text, node.start, node.end, replacement)
    }
    case 'renameProperty': {
      const { key } = yamlPairAt(root, op.path)
      if (!key) return text
      return splice(text, key.start, key.end, yamlKey(op.newKey, text.slice(key.start, key.end)))
    }
    case 'removeProperty': {
      const parent = yamlNodeAt(root, op.path.slice(0, -1))
      if (!parent || !isMap(parent)) return text
      const last = String(op.path[op.path.length - 1])
      const index = parent.items.findLastIndex((item) => keyName(item.key) === last)
      if (index === -1) return text
      const pair = parent.items[index]
      const key = pair?.key as YamlNode
      const value = pair?.value as YamlNode | undefined
      // Flow map (`{ a: 1, b: 2 }`): excise just this member plus one adjoining
      // comma, keeping the braces and the surviving members on their shared line.
      if (text.charCodeAt(parent.start) === 123 /* { */) {
        if (parent.items.length === 1) return splice(text, parent.start + 1, parent.end - 1, '')
        // Not the last member: take the comma and gap up to the next key.
        if (index < parent.items.length - 1) {
          const next = parent.items[index + 1]?.key as YamlNode
          return splice(text, key.start, next.start, '')
        }
        // Last member: take the trailing comma and gap left by the previous one.
        const prev = parent.items[index - 1]
        const prevEnd = ((prev?.value ?? prev?.key) as YamlNode).end
        return splice(text, prevEnd, (value ?? key).end, '')
      }
      // Compact sequence-entry map (`- a: 1\n    b: 2`): the first pair shares its
      // line with the parent seq's `- ` dash. Dropping the whole line would swallow
      // the dash and merge this item into its sibling, so splice only the pair's own
      // span. A lone key falls through to whole-line removal (the item disappears).
      const dashPrefix = text.slice(lineStart(text, key.start), key.start)
      if (/^\s*-\s+$/.test(dashPrefix) && parent.items.length > 1) {
        const next = parent.items[index + 1]?.key as YamlNode | undefined
        if (next) return splice(text, key.start, next.start, '')
        return splice(text, key.start, (value ?? key).end, '')
      }
      // Block map: drop the whole line(s) the property occupies.
      const [start, end] = expandLine(text, key.start, value ? value.end : key.end)
      return splice(text, start, end, '')
    }
    case 'removeItems': {
      const seq = yamlNodeAt(root, op.path)
      if (!seq || !isSeq(seq)) return text
      const removed = new Set(op.indices)
      return rewriteYamlSeq(
        text,
        seq,
        seq.items.filter((_, index) => !removed.has(index)),
      )
    }
    case 'reorderArray': {
      const seq = yamlNodeAt(root, op.path)
      if (!seq || !isSeq(seq) || seq.items.length === 0) return text
      const reordered = op.order.map((index) => seq.items[index]).filter((item): item is YamlNode => item != null)
      return rewriteYamlSeq(text, seq, reordered)
    }
    case 'insertProperty': {
      const parent = yamlNodeAt(root, op.path)
      if (!parent) {
        // The target may be an explicit-empty key (`parent:` with a null value).
        // Turn it into a one-key block map on the next line rather than no-op.
        const { key, value } = yamlPairAt(root, op.path)
        if (key && value === undefined) {
          const colon = text.indexOf(':', key.end)
          if (colon !== -1) {
            const indent = ' '.repeat(key.start - lineStart(text, key.start) + 2)
            const pair = `${yamlInsertKey(op.key)}: ${yamlInsertValue(op.value)}`
            return splice(text, colon + 1, colon + 1, `${eol}${indent}${pair}`)
          }
        }
        return text
      }
      if (!isMap(parent)) return text
      // Inserting is additive only; if the key is already there we leave it alone.
      if (parent.items.some((item) => keyName(item.key) === op.key)) return text
      const pair = `${yamlInsertKey(op.key)}: ${yamlInsertValue(op.value)}`
      if (text.charCodeAt(parent.start) === 123 /* { */) {
        const last = parent.items[parent.items.length - 1]
        // Append right after the last entry (keeping the brace's own spacing); an
        // empty `{}` gets the pair tucked just inside the opening brace.
        if (last) {
          const lastEnd = ((last.value ?? last.key) as YamlNode).end
          return splice(text, lastEnd, lastEnd, `, ${pair}`)
        }
        return splice(text, parent.start + 1, parent.start + 1, pair)
      }
      // Block map: mirror the existing keys' indentation and add a line after the last one.
      const last = parent.items[parent.items.length - 1]
      const lastKey = last?.key as YamlNode | undefined
      if (!lastKey) return text
      // Indent from the key's *column*, not the line's leading whitespace: in a
      // compact seq-item map the last key sits after a `- ` dash, so the line
      // indent (2) would place the new key outside the item — use the column (4).
      const keyLineStart = lineStart(text, lastKey.start)
      const prefix = text.slice(keyLineStart, lastKey.start)
      const indent = /^\s*$/.test(prefix) ? prefix : ' '.repeat(lastKey.start - keyLineStart)
      const [, end] = expandLine(text, lastKey.start, ((last?.value ?? lastKey) as YamlNode).end)
      const lead = end > 0 && text.charCodeAt(end - 1) !== 10 ? eol : ''
      return splice(text, end, end, `${lead}${indent}${pair}${eol}`)
    }
    case 'insertItem': {
      const seq = yamlNodeAt(root, op.path)
      if (!seq || !isSeq(seq)) return text
      const value = yamlInsertValue(op.value)
      if (text.charCodeAt(seq.start) === 91 /* [ */) {
        const items = seq.items.map((item) => text.slice((item as YamlNode).start, (item as YamlNode).end))
        items.splice(clampIndex(op.index, items.length), 0, value)
        return splice(text, seq.start + 1, seq.end - 1, items.join(', '))
      }
      // Block sequence: we need an existing `- item` line to mirror its indentation and style.
      if (seq.items.length === 0) return text
      const blocks = seqBlocks(text, seq.items)
      const regionStart = (blocks[0] as [number, number])[0]
      const regionEnd = (blocks[blocks.length - 1] as [number, number])[1]
      const lines = seq.items.map((_, index) => text.slice(...(blocks[index] as [number, number])))
      const newLine = `${seqItemIndent(text, seq.items[0] as YamlNode)}- ${value}${eol}`
      lines.splice(clampIndex(op.index, lines.length), 0, newLine)
      return splice(text, regionStart, regionEnd, lines.join(''))
    }
  }
}

/** Clamps an optional insertion index into `[0, length]`, defaulting to an append. */
const clampIndex = (index: number | undefined, length: number): number => Math.max(0, Math.min(index ?? length, length))

/**
 * Whole-line spans for each block-sequence item, with any comment-only or blank
 * lines that precede an item folded into that item's block. Attaching leading
 * comments to the following item means a reorder carries them along and a removal
 * takes only the comments that belong to the dropped item — honoring the module's
 * promise to preserve comments rather than dropping every line between items.
 */
const seqBlocks = (text: string, items: readonly YamlNode[]): [number, number][] => {
  const blocks: [number, number][] = []
  items.forEach((item, i) => {
    const [start, end] = expandLine(text, item.start, item.end)
    // For every item after the first, start the block at the end of the previous
    // item's line so the comment/blank lines between the two travel with this item.
    blocks.push([i === 0 ? start : (blocks[i - 1] as [number, number])[1], end])
  })
  return blocks
}

/**
 * Rewrites a YAML sequence to contain exactly `newItems` (a subset and/or
 * reordering of the original nodes), preserving each kept item's own text. Flow
 * sequences (`[a, b]`) are rebuilt inside their brackets; block sequences (one
 * `- item` per line) are rebuilt from their whole-line spans, carrying each item's
 * preceding comments with it.
 */
const rewriteYamlSeq = (text: string, seq: YamlSeq, newItems: YamlNode[]): string => {
  const isFlow = text.charCodeAt(seq.start) === 91 /* [ */
  if (isFlow) {
    const inner = newItems.map((item) => text.slice(item.start, item.end)).join(', ')
    return splice(text, seq.start + 1, seq.end - 1, inner)
  }
  if (seq.items.length === 0) return text
  const blocks = seqBlocks(text, seq.items)
  const regionStart = (blocks[0] as [number, number])[0]
  const regionEnd = (blocks[blocks.length - 1] as [number, number])[1]
  const blockText = new Map(seq.items.map((item, index) => [item, text.slice(...(blocks[index] as [number, number]))]))
  const rebuilt = newItems.map((item) => blockText.get(item) ?? '').join('')
  return splice(text, regionStart, regionEnd, rebuilt)
}

// --- JSON ------------------------------------------------------------------

/** Formatting options for jsonc-parser edits, carrying the file's own line ending. */
const jsonFormat = (eol: string): { insertSpaces: true; tabSize: 2; eol: string } => ({
  insertSpaces: true,
  tabSize: 2,
  eol,
})

/**
 * jsonc-parser keys path segments by JS type — strings index objects, numbers
 * index arrays — but a finding's path carries numeric-like object keys (e.g. a
 * `"200"` response) as plain numbers. Walk the tree and coerce each segment to
 * the type its parent expects, so both keys and indices resolve (and `modify`
 * doesn't mistake a `"200"` key for an array index and throw).
 */
const normalizeJsonPath = (root: Node, path: JsonPath): (string | number)[] => {
  const result: (string | number)[] = []
  let node: Node | undefined = root
  for (const segment of path) {
    const normalized: string | number = node?.type === 'array' ? Number(segment) : String(segment)
    result.push(normalized)
    node = node ? findNodeAtLocation(node, [normalized]) : undefined
  }
  return result
}

/**
 * Rewrites a JSON array to contain exactly `keptChildren`, slicing each element's
 * original source so numeric literals (`1.50`), escapes, and Unicode survive byte
 * for byte. Separators, leading, and trailing whitespace are taken from the
 * original array, so a one-line array stays on one line and a multi-line array
 * keeps its indentation instead of being re-serialized with a hardcoded style.
 */
const rewriteJsonArray = (text: string, node: Node, keptChildren: Node[]): string => {
  const children = node.children ?? []
  const open = node.offset + 1
  const close = node.offset + node.length - 1
  if (children.length === 0) return text
  const first = children[0] as Node
  const last = children[children.length - 1] as Node
  if (keptChildren.length === 0) return splice(text, open, close, '')
  const leading = text.slice(open, first.offset)
  const trailing = text.slice(last.offset + last.length, close)
  // The separator between two elements, captured from the source so we reuse the
  // file's own comma, newline, and indentation rather than inventing them.
  const separator = children.length > 1 ? text.slice(first.offset + first.length, (children[1] as Node).offset) : ', '
  const inner = keptChildren.map((child) => text.slice(child.offset, child.offset + child.length)).join(separator)
  return splice(text, open, close, leading + inner + trailing)
}

const applyJsonOp = (text: string, op: EditOp): string => {
  const root = parseTree(text)
  if (!root) return text
  const path = normalizeJsonPath(root, op.path)
  const format = jsonFormat(detectEol(text))
  switch (op.op) {
    case 'setValue':
      // `modify` would happily *create* a missing path (and every ancestor along
      // it), which violates the contract that an unresolved path is a no-op — so
      // only edit when the node actually exists.
      if (!findNodeAtLocation(root, path)) return text
      return applyEdits(text, modify(text, path, op.value, { formattingOptions: format }))
    case 'removeProperty':
      if (!findNodeAtLocation(root, path)) return text
      return applyEdits(text, modify(text, path, undefined, { formattingOptions: format }))
    case 'renameProperty': {
      const valueNode = findNodeAtLocation(root, path)
      // Only a real object member can be renamed. An array-index path has an
      // `array` parent, whose first child is element 0 — renaming there would
      // overwrite that element, so bail instead.
      if (valueNode?.parent?.type !== 'property') return text
      const keyNode = valueNode.parent.children?.[0] as Node | undefined
      if (!keyNode) return text
      return splice(text, keyNode.offset, keyNode.offset + keyNode.length, JSON.stringify(op.newKey))
    }
    case 'removeItems': {
      const node = findNodeAtLocation(root, path)
      if (!node || node.type !== 'array') return text
      const removed = new Set(op.indices)
      const kept = (node.children ?? []).filter((_, index) => !removed.has(index))
      return rewriteJsonArray(text, node, kept)
    }
    case 'reorderArray': {
      const node = findNodeAtLocation(root, path)
      if (!node || node.type !== 'array') return text
      const children = node.children ?? []
      const reordered = op.order.map((index) => children[index]).filter((child): child is Node => child != null)
      return rewriteJsonArray(text, node, reordered)
    }
    case 'insertProperty': {
      const node = findNodeAtLocation(root, path)
      if (!node || node.type !== 'object') return text
      // Additive only: writing to an existing key would replace its value, so bail.
      if (node.children?.some((property) => property.children?.[0]?.value === op.key)) return text
      return applyEdits(text, modify(text, [...path, op.key], op.value, { formattingOptions: format }))
    }
    case 'insertItem': {
      const node = findNodeAtLocation(root, path)
      if (!node || node.type !== 'array') return text
      const index = clampIndex(op.index, node.children?.length ?? 0)
      return applyEdits(
        text,
        modify(text, [...path, index], op.value, { formattingOptions: format, isArrayInsertion: true }),
      )
    }
  }
}

/** The text after applying a batch of edits, plus which ops actually changed it. */
export type ApplyEditOpsResult = {
  output: string
  /** `changed[i]` is whether `ops[i]` altered the text (false when its path no longer resolved). */
  changed: boolean[]
}

/**
 * Applies `ops` to `source`, reporting both the edited text and, per op, whether
 * it actually changed anything. Each op is lowered to a minimal text edit and
 * applied sequentially (re-parsing between ops so offsets stay valid), preserving
 * the formatting of everything it does not touch. An op whose target path no
 * longer resolves is a no-op rather than an error — callers use `changed` to tell
 * a real fix from one that quietly dropped out (e.g. its node was already gone).
 */
export const applyEditOpsWithChanges = (source: string, format: ParserFormat, ops: EditOp[]): ApplyEditOpsResult => {
  let text = source
  const changed: boolean[] = []
  for (const op of ops) {
    const before = text
    // An op that can't be lowered (an unresolved path, a key the underlying
    // editor rejects) must be a no-op, never a thrown error that aborts the
    // whole batch — one bad edit should not drop every other fix.
    try {
      text = format === 'json' ? applyJsonOp(text, op) : applyYamlOp(text, op)
    } catch {
      text = before
    }
    changed.push(text !== before)
  }
  return { output: text, changed }
}

/** Applies `ops` to `source` and returns just the edited text. See {@link applyEditOpsWithChanges}. */
export const applyEditOps = (source: string, format: ParserFormat, ops: EditOp[]): string =>
  applyEditOpsWithChanges(source, format, ops).output
