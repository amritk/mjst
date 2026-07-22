import { parseDocument } from './parse-document'
import type { ParseOptions } from './types'

/**
 * Parses a YAML string straight to its JavaScript value, the way `JSON.parse`
 * would. Use {@link parseDocument} instead when you need source ranges or the
 * list of problems for diagnostics.
 *
 * @example
 * ```ts
 * const value = parse('info:\n  title: My API\n  version: 1.0.0\n')
 * // value.info.version is the STRING "1.0.0" (YAML 1.2 core schema), not a number.
 * // Errors are collected, not thrown — use parseDocument() and read doc.errors.
 * ```
 */
export const parse = (source: string, options?: ParseOptions): unknown => parseDocument(source, options).toJS()
