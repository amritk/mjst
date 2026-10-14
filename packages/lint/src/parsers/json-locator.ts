import { createLineMap, type LineMap } from './lines'
import type { ILocation, JsonPath } from './types'

/** An array index in the only spelling a JSON array answers to. */
const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/

const QUOTE = 34
const BACKSLASH = 92
const OPEN_BRACE = 123
const CLOSE_BRACE = 125
const OPEN_BRACKET = 91
const CLOSE_BRACKET = 93
const COMMA = 44

const isWhitespace = (code: number): boolean => code === 32 || code === 10 || code === 13 || code === 9

/** The offset just past the string literal whose opening quote is at `start`, or `-1` when it never closes. */
const stringEnd = (source: string, start: number): number => {
  let quote = source.indexOf('"', start + 1)
  while (quote !== -1) {
    // A quote is escaped when an odd number of backslashes runs up to it.
    let slashes = 0
    for (let i = quote - 1; source.charCodeAt(i) === BACKSLASH; i--) slashes++
    if ((slashes & 1) === 0) return quote + 1
    quote = source.indexOf('"', quote + 1)
  }
  return -1
}

/**
 * A key as the parsed data holds it: escapes decoded. Only a key that has a
 * backslash needs decoding, and one whose escapes are not JSON is kept raw.
 */
const decodeKey = (literal: string): string => {
  const raw = literal.slice(1, -1)
  if (!raw.includes('\\')) return raw
  try {
    return JSON.parse(literal) as string
  } catch {
    return raw
  }
}

/**
 * The members of one object or array, found the first time a lookup steps
 * into it. Offsets are `[start, end)` of each member's value.
 */
type Container =
  /** First occurrence of each key, as a duplicate is found by the tree lookup this replaces. */
  | { kind: 'object'; members: Map<string, number>; starts: number[]; ends: number[] }
  | { kind: 'array'; starts: number[]; ends: number[] }

/**
 * Resolves JSON paths to source ranges by scanning `source` on demand. The
 * source is expected to be valid JSON; text that is not still gets an answer
 * (and never a hang or a throw), just not a meaningful one.
 *
 * The eager alternative builds a node for every value in the document before
 * the first lookup, which on a 25 MB spec costs several times the
 * `JSON.parse` that produced the data. A lint run only asks for the handful
 * of paths that carry findings, so this indexes just the containers a lookup
 * passes through, once each: a container's members are listed the first time
 * any lookup enters it, and every later lookup through it is a map read.
 *
 * Ranges are the ones a `jsonc-parser` tree gives for the same path: a
 * string's range includes its quotes, a container's its brackets, and among
 * duplicate keys the first one is found.
 */
export const createJsonLocator = (
  source: string,
  lineMap?: LineMap,
): ((path: JsonPath, closest?: boolean) => ILocation | undefined) => {
  const length = source.length
  const containers = new Map<number, Container>()
  let lines = lineMap

  const skipWhitespace = (offset: number): number => {
    let i = offset
    while (i < length && isWhitespace(source.charCodeAt(i))) i++
    return i
  }

  /** The offset just past the value starting at `start`. */
  const valueEnd = (start: number): number => {
    const first = source.charCodeAt(start)
    if (first === QUOTE) return stringEnd(source, start)
    if (first === OPEN_BRACE || first === OPEN_BRACKET) {
      let depth = 0
      for (let i = start; i < length; i++) {
        const code = source.charCodeAt(i)
        if (code === QUOTE) {
          const close = stringEnd(source, i)
          if (close === -1) return length
          i = close - 1
        } else if (code === OPEN_BRACE || code === OPEN_BRACKET) depth++
        else if (code === CLOSE_BRACE || code === CLOSE_BRACKET) {
          depth--
          if (depth === 0) return i + 1
        }
      }
      return length
    }
    // A number or a literal runs to the next delimiter.
    let i = start
    while (i < length) {
      const code = source.charCodeAt(i)
      if (code === COMMA || code === CLOSE_BRACE || code === CLOSE_BRACKET || isWhitespace(code)) break
      i++
    }
    return i
  }

  /** Lists the members of the container opening at `start`. */
  const index = (start: number): Container => {
    const cached = containers.get(start)
    if (cached !== undefined) return cached
    const isObject = source.charCodeAt(start) === OPEN_BRACE
    const close = isObject ? CLOSE_BRACE : CLOSE_BRACKET
    const members = new Map<string, number>()
    const starts: number[] = []
    const ends: number[] = []
    let i = skipWhitespace(start + 1)
    while (i < length && source.charCodeAt(i) !== close) {
      if (isObject) {
        const keyEnd = source.charCodeAt(i) === QUOTE ? stringEnd(source, i) : -1
        if (keyEnd === -1) break
        const key = decodeKey(source.slice(i, keyEnd))
        if (!members.has(key)) members.set(key, starts.length)
        // Past the key, its `:` and the whitespace around it.
        i = skipWhitespace(skipWhitespace(keyEnd) + 1)
      }
      const end = valueEnd(i)
      // Text that is not JSON after all: stop listing rather than loop.
      if (end <= i) break
      starts.push(i)
      ends.push(end)
      i = skipWhitespace(end)
      if (source.charCodeAt(i) === COMMA) i = skipWhitespace(i + 1)
    }
    const container: Container = isObject ? { kind: 'object', members, starts, ends } : { kind: 'array', starts, ends }
    containers.set(start, container)
    return container
  }

  const toLocation = (start: number, end: number): ILocation => {
    if (lines === undefined) lines = createLineMap(source)
    return { range: { start: lines.positionAt(start), end: lines.positionAt(end) } }
  }

  // Where the root value starts and ends. In valid JSON nothing but
  // whitespace follows the root, so its end is read off the back of the text
  // rather than found by scanning past everything in it.
  let rootStart = -1
  let rootEnd = -1

  return (path, closest = false) => {
    if (rootStart === -1) {
      rootStart = skipWhitespace(0)
      rootEnd = length
      while (rootEnd > rootStart && isWhitespace(source.charCodeAt(rootEnd - 1))) rootEnd--
    }
    if (rootStart >= length) return undefined
    let start = rootStart
    let end = rootEnd
    for (const segment of path) {
      const first = source.charCodeAt(start)
      let member = -1
      if (first === OPEN_BRACE) {
        const container = index(start) as Extract<Container, { kind: 'object' }>
        member = container.members.get(String(segment)) ?? -1
      } else if (first === OPEN_BRACKET) {
        const text = String(segment)
        if (ARRAY_INDEX.test(text)) {
          const position = Number(text)
          if (position < index(start).starts.length) member = position
        }
      }
      // A path that leaves the document lands on the deepest node it reached,
      // when asked for the closest one.
      if (member === -1) return closest ? toLocation(start, end) : undefined
      const container = index(start)
      start = container.starts[member] as number
      end = container.ends[member] as number
    }
    return toLocation(start, end)
  }
}
