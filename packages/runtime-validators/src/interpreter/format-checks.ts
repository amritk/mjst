/**
 * Built-in `format` validators.
 *
 * Formats are opt-in (see {@link ValidateOptions.formats}) because their
 * strictness is a judgement call, and these are deliberately pragmatic: a check
 * that is fast and rejects the input people actually get wrong beats an
 * RFC-perfect parser that shows up in every flame graph. Where a cheap regex
 * genuinely cannot answer the question — a calendar day, a leap second — the
 * check does the arithmetic instead, because "2020-02-30 is a date" is not a
 * pedantic disagreement, it is a wrong answer.
 *
 * Ajv (with `ajv-formats`) is the oracle: it is what most JSON Schema consumers
 * measure against, and `format-checks.test.ts` compares the two value by value.
 *
 * Every check is a predicate rather than a bare `RegExp` so the regex-only and
 * the arithmetic cases present one shape to the compiler. Each is built once at
 * module load and reused on every validation.
 */

// A few patterns are shared by an ASCII format and its internationalized
// sibling, which differs only in which characters a label may hold.
const ASCII_LABEL = '[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?'
const IDN_LABEL = '[\\p{L}\\p{N}](?:[\\p{L}\\p{N}\\p{M}-]{0,61}[\\p{L}\\p{N}\\p{M}])?'

// RFC 5322's practical subset, as `ajv-formats` reads it: dot-separated atoms,
// so a leading, trailing or doubled dot in the local part is rejected — the
// mistake a bare "one @, a dot somewhere" check waves through.
const ASCII_ATOM = "[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]"
const IDN_ATOM = "[\\p{L}\\p{N}\\p{M}!#$%&'*+/=?^_`{|}~-]"

const emailPattern = (atom: string, label: string, unicode: boolean): RegExp =>
  new RegExp(`^${atom}+(?:\\.${atom}+)*@(?:${label}\\.)+${label}$`, unicode ? 'u' : '')

const EMAIL = emailPattern(ASCII_ATOM, ASCII_LABEL, false)
const IDN_EMAIL = emailPattern(IDN_ATOM, IDN_LABEL, true)

// A hostname's labels are letters, digits and hyphens, and a label may not
// start or end with a hyphen. No trailing dot: the root label is legal in a DNS
// *name*, but the official suite requires `example.` to be rejected as a
// `hostname`, and where the suite and Ajv disagree the suite wins — it is the
// specification's own corpus, and Ajv accepts the trailing dot.
const HOSTNAME = new RegExp(`^(?=.{1,253}$)${ASCII_LABEL}(?:\\.${ASCII_LABEL})*$`)
// Label and total length are counted in code points, not punycode octets.
// RFC 5890 exactness — decoding an A-label, the Bidi rule, the contextual rules
// around MIDDLE DOT and the joiners — is out of scope; see `format-checks.test.ts`.
const IDN_HOSTNAME = new RegExp(`^(?=.{1,253}$)${IDN_LABEL}(?:\\.${IDN_LABEL})*$`, 'u')

// --- IP addresses ----------------------------------------------------------
//
// IPv6 per RFC 4291, assembled from its grammar's building blocks so the
// IPv4-embedded forms (`x:x:x:x:x:x:d.d.d.d`, e.g. `::ffff:192.168.0.1`) are
// accepted — a single hand-written alternation reliably omits them. `h16` is a
// 16-bit hex group; `ls32` is the least-significant 32 bits, either two groups
// or a dotted-quad IPv4.
const H16 = '[0-9a-fA-F]{1,4}'
// The `[1-9]?\d` tail (rather than `1?\d?\d`) is what forbids a leading zero:
// `01.2.3.4` is not a valid dotted quad, and accepting it is the classic
// octal-interpretation allowlist bypass — `010` reads as 8 to some resolvers and
// as 10 to others, so an allowlist and the code behind it can disagree.
const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4_OCTETS = `(?:${IPV4_OCTET}\\.){3}${IPV4_OCTET}`
const LS32 = `(?:${H16}:${H16}|${IPV4_OCTETS})`

// Kept unanchored so the URI grammar below can embed it as an `IP-literal`.
const IPV6_BODY =
  `(?:(?:${H16}:){6}${LS32}` +
  `|::(?:${H16}:){5}${LS32}` +
  `|(?:${H16})?::(?:${H16}:){4}${LS32}` +
  `|(?:(?:${H16}:){0,1}${H16})?::(?:${H16}:){3}${LS32}` +
  `|(?:(?:${H16}:){0,2}${H16})?::(?:${H16}:){2}${LS32}` +
  `|(?:(?:${H16}:){0,3}${H16})?::(?:${H16}:)${LS32}` +
  `|(?:(?:${H16}:){0,4}${H16})?::${LS32}` +
  `|(?:(?:${H16}:){0,5}${H16})?::${H16}` +
  `|(?:(?:${H16}:){0,6}${H16})?::)`

const IPV4 = new RegExp(`^${IPV4_OCTETS}$`)
const IPV6 = new RegExp(`^${IPV6_BODY}$`)

// --- RFC 3986 URIs, and their RFC 3987 internationalized siblings -----------
//
// Assembled from the ABNF's own productions rather than written as one
// alternation, because the questions the corpus actually asks — is `%GG` a
// valid escape, may a path segment hold `[`, is `abc` a port — are each answered
// by one production, and a hand-rolled "anything without a space" pattern
// answers none of them.
//
// An IRI is the same grammar with a wider `unreserved`, so both are built from
// one function and differ only in that character class.

const SUB_DELIMS = "!$&'()*+,;="
const PCT_ENCODED = '%[0-9A-Fa-f]{2}'
// RFC 3987's `ucschar`: the private-use and surrogate blocks are the notable
// exclusions, which is why this is a list of ranges rather than "not ASCII".
const UCSCHAR =
  '\\u00A0-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFEF' +
  '\\u{10000}-\\u{1FFFD}\\u{20000}-\\u{2FFFD}\\u{30000}-\\u{3FFFD}\\u{40000}-\\u{4FFFD}' +
  '\\u{50000}-\\u{5FFFD}\\u{60000}-\\u{6FFFD}\\u{70000}-\\u{7FFFD}\\u{80000}-\\u{8FFFD}' +
  '\\u{90000}-\\u{9FFFD}\\u{A0000}-\\u{AFFFD}\\u{B0000}-\\u{BFFFD}\\u{C0000}-\\u{CFFFD}' +
  '\\u{D0000}-\\u{DFFFD}\\u{E1000}-\\u{EFFFD}'

// RFC 3987's `iprivate`: the private-use planes, which an IRI may carry in a
// query (and nowhere else).
const IPRIVATE = '\\uE000-\\uF8FF\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}'

/**
 * Builds the `URI` and `URI-reference` patterns over a given `unreserved` set —
 * ASCII for RFC 3986, ASCII plus `ucschar` for RFC 3987, whose query also admits
 * `iprivate`.
 */
const uriGrammar = (extraUnreserved: string, privateQuery = ''): { uri: string; reference: string } => {
  const unreserved = `A-Za-z0-9\\-._~${extraUnreserved}`
  const scheme = '[A-Za-z][A-Za-z0-9+\\-.]*'
  const pchar = `(?:[${unreserved}${SUB_DELIMS}:@]|${PCT_ENCODED})`
  const segment = `${pchar}*`
  const segmentNz = `${pchar}+`
  // A relative path's first segment may not hold a colon — otherwise `1:b` would
  // read as a scheme.
  const segmentNzNc = `(?:[${unreserved}${SUB_DELIMS}@]|${PCT_ENCODED})+`
  const userinfo = `(?:[${unreserved}${SUB_DELIMS}:]|${PCT_ENCODED})*`
  const ipvFuture = `[Vv][0-9A-Fa-f]+\\.[${unreserved}${SUB_DELIMS}:]+`
  const ipLiteral = `\\[(?:${IPV6_BODY}|${ipvFuture})\\]`
  const regName = `(?:[${unreserved}${SUB_DELIMS}]|${PCT_ENCODED})*`
  const host = `(?:${ipLiteral}|${IPV4_OCTETS}|${regName})`
  const authority = `(?:${userinfo}@)?${host}(?::\\d*)?`

  const pathAbempty = `(?:/${segment})*`
  const pathAbsolute = `/(?:${segmentNz}(?:/${segment})*)?`
  const pathRootless = `${segmentNz}(?:/${segment})*`
  const pathNoscheme = `${segmentNzNc}(?:/${segment})*`

  const hierPart = `(?://${authority}${pathAbempty}|${pathAbsolute}|${pathRootless}|)`
  const relativePart = `(?://${authority}${pathAbempty}|${pathAbsolute}|${pathNoscheme}|)`
  const query = `(?:\\?(?:${pchar}|[/?${privateQuery}])*)?`
  const fragment = `(?:#(?:${pchar}|[/?])*)?`

  return {
    uri: `^${scheme}:${hierPart}${query}${fragment}$`,
    reference: `^(?:${scheme}:${hierPart}|${relativePart})${query}${fragment}$`,
  }
}

const ASCII_URI = uriGrammar('')
const IRI_URI = uriGrammar(UCSCHAR, IPRIVATE)

const URI = new RegExp(ASCII_URI.uri)
const URI_REFERENCE = new RegExp(ASCII_URI.reference)
const IRI = new RegExp(IRI_URI.uri, 'u')
const IRI_REFERENCE = new RegExp(IRI_URI.reference, 'u')

// --- RFC 6570 URI templates ------------------------------------------------
//
// Also assembled from its ABNF, for the same reason: the corpus asks whether
// `{v:0}`, `{a..b}` and `{a,}` are templates, and each is one production away.

// `literals` excludes the characters that must be percent-encoded — space, the
// quoting and bracketing characters, and DEL — while `{` and `}` are handled by
// the expression production rather than here.
const TEMPLATE_LITERAL = `(?:[!#$&(-;=?-\\[\\]_a-z~${UCSCHAR}${IPRIVATE}]|${PCT_ENCODED})`
const VARCHAR = `(?:[A-Za-z0-9_]|${PCT_ENCODED})`
// A varname is dot-separated: a doubled or trailing dot is not a name.
const VARNAME = `${VARCHAR}(?:\\.?${VARCHAR})*`
// `max-length` is 1-9999, so it neither starts with `0` nor runs past four digits.
const MODIFIER = '(?::[1-9]\\d{0,3}|\\*)?'
const VARSPEC = `${VARNAME}${MODIFIER}`
const EXPRESSION = `\\{[+#./;?&=,!@|]?${VARSPEC}(?:,${VARSPEC})*\\}`
const URI_TEMPLATE = new RegExp(`^(?:${TEMPLATE_LITERAL}|${EXPRESSION})*$`, 'iu')

// --- dates and times -------------------------------------------------------

const DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const isLeapYear = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)

/**
 * RFC 3339 `full-date`. The shape is a regex, but the day is arithmetic: a
 * pattern cannot know that February has 29 days in 2020 and 28 in 1998, so a
 * regex-only check calls `2020-02-30` and `1998-02-29` dates. They are not, and
 * a date field that accepts them is not validating anything a caller cares
 * about.
 */
const isDate = (value: string): boolean => {
  const matches = DATE.exec(value)
  if (matches === null) return false
  const year = +(matches[1] as string)
  const month = +(matches[2] as string)
  const day = +(matches[3] as string)
  if (month < 1 || month > 12 || day < 1) return false
  return day <= (month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month] as number))
}

// RFC 3339 splits the fraction off the seconds, and so does this: parsing
// `59.999999999999999` as a number rounds it to exactly 60, which would read a
// perfectly ordinary sub-second timestamp as a leap second.
// `time-numoffset` is `("+" / "-") time-hour ":" time-minute` — the colon and
// the minutes are both required, so `+0130` and `+01` are not offsets.
const TIME = /^(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:([Zz])|([+-])(\d\d):(\d\d))?$/

/**
 * RFC 3339 `full-time` (`requireOffset`) or `partial-time`.
 *
 * The offset is required for the `time` format — a bare `12:00:00` names no
 * instant, which is the ambiguity the format exists to remove — and optional for
 * `iso-time`.
 *
 * Second `60` is a leap second, and a leap second only ever happens at the end
 * of a UTC day. So `23:59:60Z` is a time and `22:59:60Z` is not, and an offset
 * moves which local reading qualifies: `01:59:60+02:00` is that same instant.
 */
const timeCheck =
  (requireOffset: boolean) =>
  (value: string): boolean => {
    const matches = TIME.exec(value)
    if (matches === null) return false
    const hour = +(matches[1] as string)
    const minute = +(matches[2] as string)
    const second = +(matches[3] as string)
    const zulu = matches[4] !== undefined
    const offsetSign = matches[5] === '-' ? -1 : 1
    const hasOffset = zulu || matches[5] !== undefined
    if (requireOffset && !hasOffset) return false

    const offsetHours = +(matches[6] ?? 0)
    const offsetMinutes = +(matches[7] ?? 0)
    if (hour > 23 || minute > 59 || second > 60 || offsetHours > 23 || offsetMinutes > 59) return false
    if (second < 60) return true

    // Past here the only way to be valid is to be a leap second, so translate
    // the local reading back to UTC and ask whether it lands at 23:59.
    const utcMinute = minute - offsetMinutes * offsetSign
    const utcHour = hour - offsetHours * offsetSign - (utcMinute < 0 ? 1 : 0)
    return (utcHour === 23 || utcHour === -1) && (utcMinute === 59 || utcMinute === -1)
  }

const isTime = timeCheck(true)
const isIsoTime = timeCheck(false)

// RFC 3339 permits a lowercase `t`, and (by its own note) a space, between the
// date and the time.
const DATE_TIME_SEPARATOR = /t|\s/i

const dateTimeCheck = (time: (value: string) => boolean) => (value: string) => {
  const parts = value.split(DATE_TIME_SEPARATOR)
  return parts.length === 2 && isDate(parts[0] as string) && time(parts[1] as string)
}

const isDateTime = dateTimeCheck(isTime)
const isIsoDateTime = dateTimeCheck(isIsoTime)

// RFC 3339 Appendix A's `duration` does not list its components, it *nests*
// them: `dur-year` is `1*DIGIT "Y" [dur-month]`, and `dur-month` is
// `1*DIGIT "M" [dur-day]`. So a year may be followed by a month (and that by a
// day), but never by a day directly — `P1Y2D` is not a duration, and neither is
// `PT1H2S`. A flat `(\d+Y)?(\d+M)?(\d+D)?` accepts both.
const DUR_SECOND = '\\d+S'
const DUR_MINUTE = `\\d+M(?:${DUR_SECOND})?`
const DUR_HOUR = `\\d+H(?:${DUR_MINUTE})?`
const DUR_TIME = `T(?:${DUR_HOUR}|${DUR_MINUTE}|${DUR_SECOND})`
const DUR_DAY = '\\d+D'
const DUR_MONTH = `\\d+M(?:${DUR_DAY})?`
const DUR_YEAR = `\\d+Y(?:${DUR_MONTH})?`
const DUR_DATE = `(?:${DUR_YEAR}|${DUR_MONTH}|${DUR_DAY})(?:${DUR_TIME})?`
const DUR_WEEK = '\\d+W'
const DURATION = new RegExp(`^P(?:${DUR_DATE}|${DUR_TIME}|${DUR_WEEK})$`)

// --- string formats --------------------------------------------------------

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/**
 * `binary` and `password` are OpenAPI annotations about how a string is carried
 * or displayed, not constraints on its characters — every string satisfies them.
 * They are listed rather than left unknown so that enabling them is a statement
 * ("this is checked, and everything passes") instead of a silent no-op.
 */
const acceptAnyString = (): boolean => true

/**
 * The `regex` format asks whether the string *itself* is a valid regular
 * expression — so unlike every other format it can't be a pattern. We compile it
 * and report the verdict instead of letting the `SyntaxError` escape.
 */
export const isValidRegex = (value: string): boolean => {
  try {
    new RegExp(value)
    return true
  } catch {
    return false
  }
}

/** A `format` check over a string instance. */
export type StringFormatCheck = (value: string) => boolean

export const FORMAT_CHECKS: Readonly<Record<string, StringFormatCheck>> = {
  email: (value) => EMAIL.test(value),
  'idn-email': (value) => IDN_EMAIL.test(value),
  date: isDate,
  'date-time': isDateTime,
  time: isTime,
  'iso-time': isIsoTime,
  'iso-date-time': isIsoDateTime,
  duration: (value) => DURATION.test(value),
  uuid: (value) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value),
  uri: (value) => URI.test(value),
  iri: (value) => IRI.test(value),
  'uri-reference': (value) => URI_REFERENCE.test(value),
  'iri-reference': (value) => IRI_REFERENCE.test(value),
  // A URL is the subset of URIs that names something retrievable, so unlike
  // `uri` it insists on a known scheme and an authority.
  url: (value) => /^(?:https?|ftp):\/\/[^/?#]/.test(value) && URI.test(value),
  'uri-template': (value) => URI_TEMPLATE.test(value),
  // JSON Pointer (RFC 6901): empty string, or `/`-separated escaped tokens.
  'json-pointer': (value) => /^(?:\/(?:[^~/]|~[01])*)*$/.test(value),
  // The same pointer carried in a URI fragment, so it leads with `#`.
  'json-pointer-uri-fragment': (value) => /^#(?:\/(?:[^~/]|~[01])*)*$/.test(value),
  // Relative JSON Pointer: a non-negative integer prefix, then `#` or a pointer.
  'relative-json-pointer': (value) => /^(?:0|[1-9]\d*)(?:#|(?:\/(?:[^~/]|~[01])*)*)$/.test(value),
  hostname: (value) => HOSTNAME.test(value),
  'idn-hostname': (value) => IDN_HOSTNAME.test(value),
  ipv4: (value) => IPV4.test(value),
  ipv6: (value) => IPV6.test(value),
  regex: isValidRegex,
  // OpenAPI's base64-encoded octet sequence.
  byte: (value) => BASE64.test(value),
  binary: acceptAnyString,
  password: acceptAnyString,
}

// --- numeric formats -------------------------------------------------------

const MIN_INT32 = -(2 ** 31)
const MAX_INT32 = 2 ** 31 - 1

/** A `format` check over a numeric instance. */
export type NumberFormatCheck = (value: number) => boolean

/**
 * OpenAPI's numeric formats. These constrain a *number*, not a string, so they
 * are kept apart from {@link FORMAT_CHECKS} and consulted by the numeric
 * keywords — the same split `ajv-formats` makes, and the reason a schema saying
 * `{ type: 'integer', format: 'int32' }` was previously checked for nothing at
 * all.
 *
 * `int64` can only ask for integrality: JSON numbers are doubles, so anything
 * beyond 2^53 has already lost the precision that would let the bound be
 * checked. `float` and `double` accept every number, for the same reason
 * `binary` accepts every string — they describe the wire, not the value.
 */
export const NUMBER_FORMAT_CHECKS: Readonly<Record<string, NumberFormatCheck>> = {
  int32: (value) => Number.isInteger(value) && value >= MIN_INT32 && value <= MAX_INT32,
  int64: (value) => Number.isInteger(value),
  float: () => true,
  double: () => true,
}
