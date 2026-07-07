import { isMap, isScalar, isSeq, parseDocument, type YamlNode, type YamlSeq } from '@amritk/yaml'
import { applyEdits, findNodeAtLocation, getNodeValue, modify, type Node, parseTree } from 'jsonc-parser'

import type { ParserFormat } from './index'
import type { JsonPath } from './types'

/**
 * A single structural edit against a parsed document, expressed in terms of JSON
 * paths and values rather than raw character offsets. {@link applyEditOps} lowers
 * each op to a minimal text edit so that untouched parts of the source — including
 * comments, key order, and quoting — keep their original formatting.
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

/** Expands `[start, end)` to cover whole lines: back to the line start, forward past the trailing newline. */
const expandLine = (text: string, start: number, end: number): [number, number] => {
  let s = start
  while (s > 0 && text.charCodeAt(s - 1) !== 10) s--
  let e = end
  while (e < text.length && text.charCodeAt(e) !== 10) e++
  if (e < text.length) e++
  return [s, e]
}

// --- YAML ------------------------------------------------------------------

const keyName = (key: unknown): string => (isScalar(key) ? String(key.value) : String(key))

/** Navigates the YAML CST to the node at `path`, or `undefined` if absent. */
const yamlNodeAt = (root: YamlNode | null, path: JsonPath): YamlNode | undefined => {
  let current: YamlNode | undefined = root ?? undefined
  for (const segment of path) {
    if (current === undefined) return undefined
    if (isMap(current)) {
      const target = String(segment)
      const pair = current.items.find((item) => keyName(item.key) === target)
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
  const pair = parent.items.find((item) => keyName(item.key) === last)
  if (!pair) return {}
  return { key: pair.key, ...(pair.value ? { value: pair.value } : {}) }
}

/** Serializes a scalar, preserving the quoting style of the value it replaces. */
const yamlScalar = (value: unknown, original: string): string => {
  if (typeof value !== 'string') return value === null ? 'null' : String(value)
  const quote = original.charCodeAt(0)
  if (quote === 34 /* " */) return JSON.stringify(value)
  if (quote === 39 /* ' */) return `'${value.replace(/'/g, "''")}'`
  return value
}

const yamlKey = (key: string, original: string): string => {
  const quote = original.charCodeAt(0)
  if (quote === 34) return JSON.stringify(key)
  if (quote === 39) return `'${key.replace(/'/g, "''")}'`
  return key
}

// Keys made only of these characters are safe to write bare in YAML; anything
// else (spaces, colons, flow indicators) gets double-quoted to stay valid.
const SAFE_YAML_KEY = /^[\w./-]+$/

/** Serializes a key for an inserted property, quoting it only when it needs to be. */
const yamlInsertKey = (key: string): string => (SAFE_YAML_KEY.test(key) ? key : JSON.stringify(key))

/**
 * Serializes a value for insertion. YAML is a JSON superset, so JSON output is
 * always valid YAML: scalars become bare literals (`42`, `true`, `"text"`) and
 * objects/arrays become inline flow (`{"a":1}`). That keeps the inserted node on
 * one line without us having to re-implement a block serializer.
 */
const yamlInsertValue = (value: unknown): string => JSON.stringify(value) ?? 'null'

/** Returns the leading whitespace of the line containing `offset` (its indentation). */
const lineIndent = (text: string, offset: number): string => {
  let start = offset
  while (start > 0 && text.charCodeAt(start - 1) !== 10) start--
  let end = start
  while (end < text.length && (text.charCodeAt(end) === 32 || text.charCodeAt(end) === 9)) end++
  return text.slice(start, end)
}

const applyYamlOp = (text: string, op: EditOp): string => {
  const root = parseDocument(text).contents as YamlNode | null
  switch (op.op) {
    case 'setValue': {
      const node = yamlNodeAt(root, op.path)
      if (!node) return text
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
      const index = parent.items.findIndex((item) => keyName(item.key) === last)
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
      if (!parent || !isMap(parent)) return text
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
      const indent = lineIndent(text, lastKey.start)
      const [, end] = expandLine(text, lastKey.start, ((last?.value ?? lastKey) as YamlNode).end)
      const lead = end > 0 && text.charCodeAt(end - 1) !== 10 ? '\n' : ''
      return splice(text, end, end, `${lead}${indent}${pair}\n`)
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
      const blocks = seq.items.map((item) => expandLine(text, (item as YamlNode).start, (item as YamlNode).end))
      const regionStart = (blocks[0] as [number, number])[0]
      const regionEnd = (blocks[blocks.length - 1] as [number, number])[1]
      const lines = seq.items.map((_, index) => text.slice(...(blocks[index] as [number, number])))
      lines.splice(clampIndex(op.index, lines.length), 0, `${lineIndent(text, regionStart)}- ${value}\n`)
      return splice(text, regionStart, regionEnd, lines.join(''))
    }
  }
}

/** Clamps an optional insertion index into `[0, length]`, defaulting to an append. */
const clampIndex = (index: number | undefined, length: number): number => Math.max(0, Math.min(index ?? length, length))

/**
 * Rewrites a YAML sequence to contain exactly `newItems` (a subset and/or
 * reordering of the original nodes), preserving each kept item's own text. Flow
 * sequences (`[a, b]`) are rebuilt inside their brackets; block sequences (one
 * `- item` per line) are rebuilt from their whole-line spans.
 */
const rewriteYamlSeq = (text: string, seq: YamlSeq, newItems: YamlNode[]): string => {
  const isFlow = text.charCodeAt(seq.start) === 91 /* [ */
  if (isFlow) {
    const inner = newItems.map((item) => text.slice(item.start, item.end)).join(', ')
    return splice(text, seq.start + 1, seq.end - 1, inner)
  }
  if (seq.items.length === 0) return text
  const blocks = seq.items.map((item) => expandLine(text, item.start, item.end))
  const regionStart = (blocks[0] as [number, number])[0]
  const regionEnd = (blocks[blocks.length - 1] as [number, number])[1]
  const blockText = new Map(seq.items.map((item, index) => [item, text.slice(...(blocks[index] as [number, number]))]))
  const rebuilt = newItems.map((item) => blockText.get(item) ?? '').join('')
  return splice(text, regionStart, regionEnd, rebuilt)
}

// --- JSON ------------------------------------------------------------------

const JSON_FORMAT = { insertSpaces: true, tabSize: 2, eol: '\n' } as const

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

const applyJsonOp = (text: string, op: EditOp): string => {
  const root = parseTree(text)
  if (!root) return text
  const path = normalizeJsonPath(root, op.path)
  switch (op.op) {
    case 'setValue':
      return applyEdits(text, modify(text, path, op.value, { formattingOptions: JSON_FORMAT }))
    case 'removeProperty':
      return applyEdits(text, modify(text, path, undefined, { formattingOptions: JSON_FORMAT }))
    case 'renameProperty': {
      const valueNode = findNodeAtLocation(root, path)
      const keyNode = valueNode?.parent?.children?.[0] as Node | undefined
      if (!keyNode) return text
      return splice(text, keyNode.offset, keyNode.offset + keyNode.length, JSON.stringify(op.newKey))
    }
    case 'removeItems': {
      // jsonc-parser's per-index array removal is unreliable, so rewrite the
      // whole array with the kept elements instead.
      const node = findNodeAtLocation(root, path)
      if (!node) return text
      const removed = new Set(op.indices)
      const kept = (getNodeValue(node) as unknown[]).filter((_, index) => !removed.has(index))
      return applyEdits(text, modify(text, path, kept, { formattingOptions: JSON_FORMAT }))
    }
    case 'reorderArray': {
      const node = findNodeAtLocation(root, path)
      if (!node) return text
      const array = getNodeValue(node) as unknown[]
      const reordered = op.order.map((index) => array[index])
      return applyEdits(text, modify(text, path, reordered, { formattingOptions: JSON_FORMAT }))
    }
    case 'insertProperty': {
      const node = findNodeAtLocation(root, path)
      if (!node || node.type !== 'object') return text
      // Additive only: writing to an existing key would replace its value, so bail.
      if (node.children?.some((property) => property.children?.[0]?.value === op.key)) return text
      return applyEdits(text, modify(text, [...path, op.key], op.value, { formattingOptions: JSON_FORMAT }))
    }
    case 'insertItem': {
      const node = findNodeAtLocation(root, path)
      if (!node || node.type !== 'array') return text
      const index = clampIndex(op.index, node.children?.length ?? 0)
      return applyEdits(
        text,
        modify(text, [...path, index], op.value, { formattingOptions: JSON_FORMAT, isArrayInsertion: true }),
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
