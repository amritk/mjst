import { readKey } from '@amritk/helpers/read-key'

export type DetectedVersion = {
  readonly major: 2 | 3
  /** The declared version string, verbatim. */
  readonly version: string
}

/**
 * Reads the document's `asyncapi` version and classifies its major.
 *
 * The major is matched with an anchored `M.` so a hypothetical `20.0.0` is not
 * mistaken for 2.x — the same guard the lint format detectors carry for minors.
 * Returns `undefined` for anything that is not an AsyncAPI 2.x/3.x document, so
 * the caller owns the error message.
 */
export const detectAsyncApiVersion = (document: unknown): DetectedVersion | undefined => {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return undefined
  // `readKey`: an `Object.prototype.asyncapi` planted by a dependency must not
  // turn every plain object into an AsyncAPI document.
  const version = readKey(document as Record<string, unknown>, 'asyncapi')
  if (typeof version !== 'string') return undefined
  if (/^2\.\d/.test(version)) return { major: 2, version }
  if (/^3\.\d/.test(version)) return { major: 3, version }
  return undefined
}
