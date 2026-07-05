/**
 * Built-in string `format` validators, expressed as regular expressions.
 *
 * These mirror the common formats from `ajv-formats` closely enough for the
 * cases people actually rely on, while staying intentionally pragmatic: a
 * regex that is fast and rejects obviously-bad input beats a spec-perfect
 * parser that shows up in every benchmark flame graph. Formats are opt-in
 * (see {@link ValidateOptions.formats}) precisely because their strictness is a
 * judgement call.
 *
 * Each entry is a `RegExp`, compiled once at module load and reused on every
 * validation call.
 */
// A few patterns are shared by an ASCII format and its internationalized
// sibling: our `uri`/`email` regexes already accept non-ASCII characters (they
// match "anything that isn't whitespace/structural"), so `iri`/`idn-email`
// reuse them rather than wrongly rejecting valid Unicode input.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URI = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/?\/?[^\s]*$/
const URI_REFERENCE = /^(?:[a-zA-Z][a-zA-Z0-9+\-.]*:)?\/?\/?[^\s]*$/

export const FORMAT_CHECKS: Readonly<Record<string, RegExp>> = {
  // Pragmatic email: one @, no spaces, a dot in the domain. Good enough for
  // gatekeeping and far cheaper than RFC 5322.
  email: EMAIL,
  'idn-email': EMAIL,
  // Range-checked so structurally impossible values (`9999-99-99T99:99:99Z`) are
  // rejected. Seconds allow `60` for the RFC 3339 leap second; day-vs-month
  // agreement (e.g. Feb 30) remains out of scope for a regex.
  'date-time':
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[Tt]([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?([Zz]|[+-]([01]\d|2[0-3]):[0-5]\d)$/,
  date: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
  time: /^([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?([Zz]|[+-]([01]\d|2[0-3]):[0-5]\d)?$/,
  // RFC 3339 duration: the week form (`P4W`) may not be mixed with Y/M/D/T
  // components; the leading `(?!$)` rejects a bare `P`.
  duration: /^P(?!$)(?:\d+W|(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?)$/,
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  uri: URI,
  iri: URI,
  'uri-reference': URI_REFERENCE,
  'iri-reference': URI_REFERENCE,
  // Loose RFC 6570: ordinary URI characters with optional `{…}` expansions.
  'uri-template': /^(?:[^\s{}]|\{[^\s{}]*\})*$/,
  // JSON Pointer (RFC 6901): empty string, or `/`-separated escaped tokens.
  'json-pointer': /^(?:\/(?:[^~/]|~[01])*)*$/,
  // Relative JSON Pointer: a non-negative integer prefix, then `#` or a pointer.
  'relative-json-pointer': /^(?:0|[1-9]\d*)(?:#|(?:\/(?:[^~/]|~[01])*)*)$/,
  hostname: /^(?=.{1,253}$)(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))*$/,
  ipv4: /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/,
  ipv6: /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|::([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(:[0-9a-fA-F]{1,4}){1,6})$/,
}

/**
 * The `regex` format asks whether the string *itself* is a valid regular
 * expression — so unlike every other format it can't be a pattern in
 * {@link FORMAT_CHECKS}. We compile it and report the verdict instead of
 * letting the `SyntaxError` escape the validator.
 */
export const isValidRegex = (value: string): boolean => {
  try {
    new RegExp(value)
    return true
  } catch {
    return false
  }
}
