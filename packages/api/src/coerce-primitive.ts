/**
 * Converts a raw string parameter to the primitive its schema declares. When
 * the string does not actually represent that primitive, the original string
 * is returned unchanged — the validator then rejects it with a proper type
 * error instead of this function guessing (`Number('abc')` is `NaN`, which
 * `typeof`-checks as a number and would otherwise slip through).
 */
export const coercePrimitive = (raw: string, kind: 'number' | 'boolean'): unknown => {
  if (kind === 'boolean') {
    return raw === 'true' ? true : raw === 'false' ? false : raw
  }
  // Number('') and Number('   ') are 0, so blank strings must stay strings.
  const value = Number(raw)
  return raw.trim() !== '' && !Number.isNaN(value) ? value : raw
}
