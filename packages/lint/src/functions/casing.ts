import type { IFunctionResult, RulesetFunction } from '../core/types'

/** The supported casing styles a value can be checked against. */
export type CasingType = 'flat' | 'camel' | 'pascal' | 'kebab' | 'cobol' | 'snake' | 'macro'

/** Options for {@link casing}. */
export type ICasingOptions = {
  type: CasingType
  disallowDigits?: boolean
  separator?: { char: string; allowLeading?: boolean }
}

/**
 * One casing style as a regular expression, split so it can be assembled safely:
 *
 * - `body` matches a whole value (with `{d}` standing in for the digit range),
 * - `tail` is an optional final character that may only appear at the very end of
 *   the *entire* value — never at the end of an inner separator-delimited part,
 * - `separator` is the character the style itself uses between segments, if any.
 */
type CasingPattern = {
  body: string
  tail?: string
  separator?: string
}

// These accept exactly the same strings Spectral's patterns do — verified by
// brute force over every string up to six characters, in both digit modes and
// with several separator settings — but they are written so no input can be
// matched two different ways.
//
// Spectral spells camel case `[a-z][a-z0-9]*(?:[A-Z0-9](?:[a-z0-9]+|$))*`, where a
// digit can be consumed either by the leading `[a-z0-9]*` run or as the head of a
// new segment. That ambiguity is a ReDoS: `'a' + '0'.repeat(44) + '!'` makes the
// engine try every split of the digits and takes over a minute on Node, on a
// string that comes straight out of the document being linted (an `operationId`,
// a property name). Here a segment head is always an uppercase letter, so digits
// have exactly one home, and the "a trailing capital is allowed" case that the
// `|$` alternative expressed becomes an explicit `tail`.
const PATTERNS: Record<CasingType, CasingPattern> = {
  flat: { body: '[a-z][a-z{d}]*' },
  camel: { body: '[a-z][a-z{d}]*(?:[A-Z][a-z{d}]+)*', tail: '[A-Z]?' },
  pascal: { body: '[A-Z][a-z{d}]*(?:[A-Z][a-z{d}]+)*', tail: '[A-Z]?' },
  // Segments after a separator may start with a digit, matching Spectral (so
  // "foo-2fa" is valid kebab case). The sub-pattern is `[a-z{d}]+`, not the
  // stricter `[a-z][a-z{d}]*` which would require a letter right after the sep.
  kebab: { body: '[a-z][a-z{d}]*(?:-[a-z{d}]+)*', separator: '-' },
  cobol: { body: '[A-Z][A-Z{d}]*(?:-[A-Z{d}]+)*', separator: '-' },
  snake: { body: '[a-z][a-z{d}]*(?:_[a-z{d}]+)*', separator: '_' },
  macro: { body: '[A-Z][A-Z{d}]*(?:_[A-Z{d}]+)*', separator: '_' },
}

const VALID_TYPES = Object.keys(PATTERNS) as CasingType[]

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const buildRegExp = (options: ICasingOptions): RegExp => {
  const digits = options.disallowDigits ? '' : '0-9'
  const pattern = PATTERNS[options.type]
  const base = pattern.body.replace(/\{d\}/g, digits)
  const tail = pattern.tail ?? ''
  if (!options.separator) return new RegExp(`^${base}${tail}$`)
  const sep = escapeRegExp(options.separator.char)
  const leading = options.separator.allowLeading ? `${sep}?` : ''
  // Splitting on the style's *own* separator (kebab parts joined by "-") adds
  // nothing: the body already accepts those joins. Repeating it anyway would let
  // each separator be consumed two ways, which is exponential on a value that
  // ends up failing — "a-a-a-…-!" is unusable at ~40 characters. Verified by
  // brute force that dropping the repetition keeps the accepted language identical.
  const repeated = options.separator.char === pattern.separator ? '' : `(?:${sep}${base})*`
  return new RegExp(`^${leading}${base}${repeated}${tail}$`)
}

/** Flags a string that does not match the configured casing style. */
export const casing: RulesetFunction<string, ICasingOptions> = (input, options) => {
  if (!options?.type) return []
  // Guard an unknown `type` before it reaches `PATTERNS[type]`, which would be
  // `undefined` and crash on `.replace`. Mirror Spectral's option schema by
  // naming every accepted value in a single, clear error finding.
  if (!VALID_TYPES.includes(options.type)) {
    return [
      {
        message: `"casing" function and its "type" option accept the following values: ${VALID_TYPES.join(', ')}`,
      },
    ] satisfies IFunctionResult[]
  }
  if (typeof input !== 'string' || input.length === 0) return []
  // Spectral special-cases a lone separator char with `allowLeading` as valid.
  // This is what keeps the OpenAPI root path "/" from being flagged.
  if (
    input.length === 1 &&
    options.separator !== undefined &&
    options.separator.allowLeading === true &&
    input === options.separator.char
  ) {
    return []
  }
  if (!buildRegExp(options).test(input)) {
    return [{ message: `The value must be in ${options.type} case` }]
  }
  return []
}
