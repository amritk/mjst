import { parseDocument } from './parse-document'
import type { ParseOptions } from './types'

/**
 * Parses a YAML string straight to its JavaScript value, the way `JSON.parse`
 * would. Use {@link parseDocument} instead when you need source ranges or the
 * list of problems for diagnostics.
 */
export const parse = (source: string, options?: ParseOptions): unknown => parseDocument(source, options).toJS()
