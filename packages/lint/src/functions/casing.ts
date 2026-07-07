import type { RulesetFunction } from '../core'

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
  kebab: '[a-z][a-z{d}]*(?:-[a-z][a-z{d}]*)*',
  cobol: '[A-Z][A-Z{d}]*(?:-[A-Z][A-Z{d}]*)*',
  snake: '[a-z][a-z{d}]*(?:_[a-z][a-z{d}]*)*',
  macro: '[A-Z][A-Z{d}]*(?:_[A-Z][A-Z{d}]*)*',
}

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
  if (typeof input !== 'string' || input.length === 0) return []
  if (!options?.type) return []
  if (!buildRegExp(options).test(input)) {
    return [{ message: `The value must be in ${options.type} case` }]
  }
  return []
}
