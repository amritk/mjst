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
  'date-time': /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/,
  duration: /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/,
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
