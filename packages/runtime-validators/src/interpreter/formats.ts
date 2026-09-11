import { FORMAT_CHECKS, NUMBER_FORMAT_CHECKS, type NumberFormatCheck, type StringFormatCheck } from './format-checks'

/**
 * A `format` checker a caller supplies for a name the built-ins do not cover —
 * or to replace one that they do.
 *
 * The bare forms are the common case and describe a **string** format, since
 * almost every format does: a `RegExp` the value must match, or a predicate.
 * The object form exists for the rest — a format over numbers (`int32` and its
 * siblings are the built-in examples), which has to say so, because a format is
 * an assertion about one JSON type and silent about every other.
 *
 * @example
 * ```typescript
 * validate(schema, {
 *   customFormats: {
 *     'phone-e164': /^\+[1-9]\d{6,14}$/,
 *     slug: (value) => value === value.toLowerCase(),
 *     port: { type: 'number', validate: (value) => Number.isInteger(value) && value > 0 && value < 65_536 },
 *   },
 * })
 * ```
 */
export type FormatDefinition =
  | RegExp
  | ((value: string) => boolean)
  | { readonly type: 'string'; readonly validate: RegExp | ((value: string) => boolean) }
  | { readonly type: 'number'; readonly validate: (value: number) => boolean }

/**
 * The formats one validator will actually check, split by the JSON type each is
 * an assertion about.
 *
 * Resolved once when the validator is built rather than consulted per node, so
 * "is this format enabled" and "which family is it" are settled before any
 * keyword is compiled — and a disabled format compiles to nothing at all rather
 * than to a per-call lookup.
 */
export type ResolvedFormats = {
  readonly strings: ReadonlyMap<string, StringFormatCheck>
  readonly numbers: ReadonlyMap<string, NumberFormatCheck>
}

/** Whether `definition` describes a numeric format rather than a string one. */
const isNumberFormat = (definition: FormatDefinition): boolean =>
  typeof definition === 'object' && !(definition instanceof RegExp) && definition.type === 'number'

const stringCheck = (definition: FormatDefinition): StringFormatCheck => {
  const validate = definition instanceof RegExp || typeof definition === 'function' ? definition : definition.validate
  return validate instanceof RegExp ? (value) => validate.test(value) : (validate as (value: string) => boolean)
}

const numberCheck = (definition: FormatDefinition): NumberFormatCheck =>
  (definition as { validate: NumberFormatCheck }).validate

/**
 * Works out which formats this validator checks, from the names it was asked to
 * enable and the definitions it was handed.
 *
 * A **custom** format is always checked. Registering one is the opt-in — there
 * is no reading of "here is a checker for `phone`" that also means "do not use
 * it" — so unlike the built-ins it does not additionally have to be named in
 * `formats`. A custom definition also *replaces* a built-in of the same name,
 * which is how a caller tightens `email` or loosens `uri` without forking the
 * package.
 *
 * The built-ins stay opt-in, matching Ajv: unlisted ones are annotations.
 */
export const resolveFormats = (
  enabled: 'all' | readonly string[] | undefined,
  custom: Readonly<Record<string, FormatDefinition>> | undefined,
): ResolvedFormats => {
  const strings = new Map<string, StringFormatCheck>()
  const numbers = new Map<string, NumberFormatCheck>()

  if (enabled === 'all') {
    for (const name of Object.keys(FORMAT_CHECKS)) strings.set(name, FORMAT_CHECKS[name] as StringFormatCheck)
    for (const name of Object.keys(NUMBER_FORMAT_CHECKS)) {
      numbers.set(name, NUMBER_FORMAT_CHECKS[name] as NumberFormatCheck)
    }
  } else if (enabled !== undefined) {
    for (const name of enabled) {
      // `Object.hasOwn`, not a bare index: the name can come from anywhere, and
      // `formats: ['toString']` would otherwise pick a function off the
      // prototype chain and call it as a check.
      if (Object.hasOwn(FORMAT_CHECKS, name)) strings.set(name, FORMAT_CHECKS[name] as StringFormatCheck)
      if (Object.hasOwn(NUMBER_FORMAT_CHECKS, name)) numbers.set(name, NUMBER_FORMAT_CHECKS[name] as NumberFormatCheck)
    }
  }

  if (custom !== undefined) {
    for (const name of Object.keys(custom)) {
      const definition = custom[name] as FormatDefinition
      if (isNumberFormat(definition)) {
        numbers.set(name, numberCheck(definition))
        // A name means one thing per validator, so replacing a built-in with a
        // definition of the other family must not leave the old one standing.
        strings.delete(name)
      } else {
        strings.set(name, stringCheck(definition))
        numbers.delete(name)
      }
    }
  }

  return { strings, numbers }
}

/** No formats at all — the default, and the one every ordinary validator shares. */
export const NO_FORMATS: ResolvedFormats = { strings: new Map(), numbers: new Map() }
