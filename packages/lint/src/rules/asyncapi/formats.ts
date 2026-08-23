import type { Format } from '../../core'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const asyncApiVersion = (document: unknown): string | undefined =>
  isObject(document) && typeof document['asyncapi'] === 'string' ? document['asyncapi'] : undefined

// Minor versions are matched with an anchored `M.N` followed by a `.` or the end
// of string, so a future `2.10.x` is not mistaken for `2.1.x` — a plain
// `startsWith('2.1')` prefix check would misclassify `2.10.0` as AsyncAPI 2.1.
const matchesMinor = (document: unknown, major: 2 | 3, minor: number): boolean => {
  const version = asyncApiVersion(document)
  return version !== undefined && new RegExp(`^${major}\\.${minor}(\\.|$)`).test(version)
}

/** Matches any AsyncAPI 2.x (`asyncapi: 2.*`). */
export const aas2: Format = (document) => /^2\.\d/.test(asyncApiVersion(document) ?? '')
/** Matches AsyncAPI 2.0.x specifically. */
export const aas2_0: Format = (document) => matchesMinor(document, 2, 0)
/** Matches AsyncAPI 2.1.x specifically. */
export const aas2_1: Format = (document) => matchesMinor(document, 2, 1)
/** Matches AsyncAPI 2.2.x specifically. */
export const aas2_2: Format = (document) => matchesMinor(document, 2, 2)
/** Matches AsyncAPI 2.3.x specifically. */
export const aas2_3: Format = (document) => matchesMinor(document, 2, 3)
/** Matches AsyncAPI 2.4.x specifically. */
export const aas2_4: Format = (document) => matchesMinor(document, 2, 4)
/** Matches AsyncAPI 2.5.x specifically. */
export const aas2_5: Format = (document) => matchesMinor(document, 2, 5)
/** Matches AsyncAPI 2.6.x specifically. */
export const aas2_6: Format = (document) => matchesMinor(document, 2, 6)
/** Matches any AsyncAPI 3.x (`asyncapi: 3.*`). */
export const aas3: Format = (document) => /^3\.\d/.test(asyncApiVersion(document) ?? '')
/** Matches AsyncAPI 3.0.x specifically. */
export const aas3_0: Format = (document) => matchesMinor(document, 3, 0)

// `aas2` / `aas3` deliberately match *any* minor of their major, including one
// this package ships no meta-schema for. A future 2.7 document still gets the
// style rules (descriptions, tags, channel naming), and the structural rules
// skip it on their own — `asyncApiDocumentSchema` reports nothing when it has no
// bundled schema for the declared version, rather than validating a 2.7 document
// against the 2.6 schema and inventing findings.

/** AsyncAPI format detectors keyed by Loupe-compatible names. */
export const aasFormats: Record<string, Format> = {
  aas2,
  'aas2.0': aas2_0,
  aas2_0,
  'aas2.1': aas2_1,
  aas2_1,
  'aas2.2': aas2_2,
  aas2_2,
  'aas2.3': aas2_3,
  aas2_3,
  'aas2.4': aas2_4,
  aas2_4,
  'aas2.5': aas2_5,
  aas2_5,
  'aas2.6': aas2_6,
  aas2_6,
  aas3,
  'aas3.0': aas3_0,
  aas3_0,
}
