import { parseDocument } from './parse-document'
import type { ParseOptions } from './types'

/**
 * Parses a YAML string straight to its JavaScript value, the way `JSON.parse`
 * would. Use {@link parseDocument} instead when you need source ranges or the
 * list of problems for diagnostics.
 *
 * Parse *problems* are collected rather than thrown, so a malformed document
 * still returns whatever data it could: call {@link parseDocument} and read
 * `doc.errors` to see them. The one thing that does throw is the guard against a
 * document built to exhaust memory — runaway `*alias` expansion (a "billion
 * laughs") or nesting deep enough to overflow the stack while projecting. Those
 * cannot produce a value at all, so they raise a catchable `Error` instead of
 * hanging the process. Wrap this call if the YAML is untrusted.
 *
 * @example
 * ```ts
 * const value = parse('info:\n  title: My API\n  version: 1.0.0\n')
 * // value.info.version is the STRING "1.0.0" (YAML 1.2 core schema), not a number.
 * // Errors are collected, not thrown — use parseDocument() and read doc.errors.
 * ```
 */
export const parse = (source: string, options?: ParseOptions): unknown => parseDocument(source, options).toJS()
