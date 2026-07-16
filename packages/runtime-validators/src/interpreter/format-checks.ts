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

// IPv6 per RFC 4291, assembled from its grammar's building blocks so the
// IPv4-embedded forms (`x:x:x:x:x:x:d.d.d.d`, e.g. `::ffff:192.168.0.1`) are
// accepted — a single hand-written alternation reliably omits them. `h16` is a
// 16-bit hex group; `ls32` is the least-significant 32 bits, either two groups
// or a dotted-quad IPv4.
const H16 = '[0-9a-fA-F]{1,4}'
const IPV4_OCTETS = '(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)'
const LS32 = `(?:${H16}:${H16}|${IPV4_OCTETS})`
const IPV6 = new RegExp(
  `^(?:${H16}:){6}${LS32}$|` +
    `^::(?:${H16}:){5}${LS32}$|` +
    `^(?:${H16})?::(?:${H16}:){4}${LS32}$|` +
    `^(?:(?:${H16}:){0,1}${H16})?::(?:${H16}:){3}${LS32}$|` +
    `^(?:(?:${H16}:){0,2}${H16})?::(?:${H16}:){2}${LS32}$|` +
    `^(?:(?:${H16}:){0,3}${H16})?::(?:${H16}:)${LS32}$|` +
    `^(?:(?:${H16}:){0,4}${H16})?::${LS32}$|` +
    `^(?:(?:${H16}:){0,5}${H16})?::${H16}$|` +
    `^(?:(?:${H16}:){0,6}${H16})?::$`,
)

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
  // Internationalized hostname: the ASCII shape above with Unicode letters,
  // digits, and combining marks allowed in labels. Label/total length is counted
  // in code points, not punycode octets (RFC 5890 exactness is out of scope).
  'idn-hostname': /^(?=.{1,253}$)(?!-)[\p{L}\p{N}\p{M}-]{1,63}(?<!-)(\.(?!-)[\p{L}\p{N}\p{M}-]{1,63}(?<!-))*$/u,
  ipv4: /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/,
  ipv6: IPV6,
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
