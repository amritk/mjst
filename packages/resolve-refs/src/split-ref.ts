/**
 * Splits a reference string into the part naming a document and the fragment
 * that addresses something inside it (a JSON Pointer, or a plain-name anchor).
 *
 * Everything before the first `#` is the document part. What that part *means*
 * depends on who is asking — `resource-registry.ts` resolves it as a URI
 * against the enclosing `$id` base, `resolve-refs-from-file.ts` as a file path
 * or URL relative to the referencing document's location — but the split itself
 * is the same one, which is why it lives here rather than in both.
 */
export const splitRef = (ref: string): { uriPart: string; fragment: string } => {
  const hashIdx = ref.indexOf('#')
  return {
    uriPart: hashIdx === -1 ? ref : ref.slice(0, hashIdx),
    fragment: hashIdx === -1 ? '' : ref.slice(hashIdx + 1),
  }
}
