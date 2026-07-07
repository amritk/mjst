/** A predicate that reports whether a parsed document matches a given format. */
export type Format = (document: unknown) => boolean

/**
 * Returns the set of registered format names that match the document. The
 * `formats` registry is supplied by the caller (a preset provides its own
 * format detectors); the engine itself is format-agnostic, so the
 * default registry is empty and rules with no `formats` gate run regardless.
 */
export const detectFormats = (document: unknown, formats: Record<string, Format> = {}): Set<string> => {
  const matched = new Set<string>()
  for (const [name, detector] of Object.entries(formats)) {
    if (detector(document)) matched.add(name)
  }
  return matched
}
