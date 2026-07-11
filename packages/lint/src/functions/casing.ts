import type { IFunctionResult, RulesetFunction } from '../core'

/** The supported casing styles a value can be checked against. */
export type CasingType = 'flat' | 'camel' | 'pascal' | 'kebab' | 'cobol' | 'snake' | 'macro'

/** Options for {@link casing}. */
export type ICasingOptions = {
  type: CasingType
  disallowDigits?: boolean
  separator?: { char: string; allowLeading?: boolean }
}

const PATTERNS: Record<CasingType, string> = {
  flat: '[a-z][a-z{d}]*',
  camel: '[a-z][a-z{d}]*(?:[A-Z{d}](?:[a-z{d}]+|$))*',
  pascal: '[A-Z][a-z{d}]*(?:[A-Z{d}](?:[a-z{d}]+|$))*',
  // Segments after a separator may start with a digit, matching Spectral (so
  // "foo-2fa" is valid kebab case). The sub-pattern is `[a-z{d}]+`, not the
  // stricter `[a-z][a-z{d}]*` which would require a letter right after the sep.
  kebab: '[a-z][a-z{d}]*(?:-[a-z{d}]+)*',
  cobol: '[A-Z][A-Z{d}]*(?:-[A-Z{d}]+)*',
  snake: '[a-z][a-z{d}]*(?:_[a-z{d}]+)*',
  macro: '[A-Z][A-Z{d}]*(?:_[A-Z{d}]+)*',
}

const VALID_TYPES = Object.keys(PATTERNS) as CasingType[]

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const buildRegExp = (options: ICasingOptions): RegExp => {
  const digits = options.disallowDigits ? '' : '0-9'
  const base = PATTERNS[options.type].replace(/\{d\}/g, digits)
  if (!options.separator) return new RegExp(`^${base}$`)
  const sep = escapeRegExp(options.separator.char)
  const leading = options.separator.allowLeading ? `${sep}?` : ''
  return new RegExp(`^${leading}${base}(?:${sep}${base})*$`)
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
