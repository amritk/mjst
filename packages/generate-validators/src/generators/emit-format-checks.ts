/**
 * The `format` checks, as emittable source.
 *
 * Generated validators are dependency-free straight-line TypeScript — that is
 * most of what makes them fast and all of what makes them readable — so a
 * generated validator cannot import `@amritk/runtime-validators`' format table.
 * It gets its own copy, and only of the formats the schema actually names.
 *
 * Two implementations of one rule is exactly the situation that drifts, so it is
 * pinned rather than trusted: `emit-format-checks.test.ts` runs this source and
 * the interpreter's table over the official suite's whole optional/format corpus
 * and requires the same verdict on every case. A divergence fails the build.
 *
 * Each entry is a source *fragment*: a `const` declaration whose name is
 * {@link formatCheckName}. Fragments may depend on shared helpers, named in
 * `needs`, which are emitted once ahead of them.
 */

/** The identifier a format's check is emitted under. */
export const formatCheckName = (format: string): string =>
  `isFormat${format
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part !== '')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join('')}`

type FormatFragment = {
  /** The JSON type the check takes — a format asserts about one and is silent about the rest. */
  readonly family: 'string' | 'number'
  /** Names of {@link SHARED} helpers this fragment reads. */
  readonly needs?: readonly string[]
  /** The `const <name> = …` declaration, with `<name>` already substituted. */
  readonly source: (name: string) => string
}

/**
 * Helpers shared by more than one fragment, emitted once when anything needs
 * them. Keyed by the identifier they declare.
 */
const SHARED: Readonly<Record<string, string>> = {
  _asciiLabel: `const _asciiLabel = '[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?'`,
  _idnLabel: `const _idnLabel = '[\\\\p{L}\\\\p{N}](?:[\\\\p{L}\\\\p{N}\\\\p{M}-]{0,61}[\\\\p{L}\\\\p{N}\\\\p{M}])?'`,
  _ipv4Octets: [
    `const _ipv4Octet = '(?:25[0-5]|2[0-4]\\\\d|1\\\\d\\\\d|[1-9]?\\\\d)'`,
    'const _ipv4Octets = `(?:${_ipv4Octet}\\\\.){3}${_ipv4Octet}`',
  ].join('\n'),
  _ipv6Body: [
    `const _h16 = '[0-9a-fA-F]{1,4}'`,
    'const _ls32 = `(?:${_h16}:${_h16}|${_ipv4Octets})`',
    'const _ipv6Body =',
    '  `(?:(?:${_h16}:){6}${_ls32}` +',
    '  `|::(?:${_h16}:){5}${_ls32}` +',
    '  `|(?:${_h16})?::(?:${_h16}:){4}${_ls32}` +',
    '  `|(?:(?:${_h16}:){0,1}${_h16})?::(?:${_h16}:){3}${_ls32}` +',
    '  `|(?:(?:${_h16}:){0,2}${_h16})?::(?:${_h16}:){2}${_ls32}` +',
    '  `|(?:(?:${_h16}:){0,3}${_h16})?::(?:${_h16}:)${_ls32}` +',
    '  `|(?:(?:${_h16}:){0,4}${_h16})?::${_ls32}` +',
    '  `|(?:(?:${_h16}:){0,5}${_h16})?::${_h16}` +',
    '  `|(?:(?:${_h16}:){0,6}${_h16})?::)`',
  ].join('\n'),
  _uriGrammar: [
    `const _subDelims = "!$&'()*+,;="`,
    `const _pctEncoded = '%[0-9A-Fa-f]{2}'`,
    'const _ucschar =',
    "  '\\\\u00A0-\\\\uD7FF\\\\uF900-\\\\uFDCF\\\\uFDF0-\\\\uFFEF' +",
    "  '\\\\u{10000}-\\\\u{1FFFD}\\\\u{20000}-\\\\u{2FFFD}\\\\u{30000}-\\\\u{3FFFD}\\\\u{40000}-\\\\u{4FFFD}' +",
    "  '\\\\u{50000}-\\\\u{5FFFD}\\\\u{60000}-\\\\u{6FFFD}\\\\u{70000}-\\\\u{7FFFD}\\\\u{80000}-\\\\u{8FFFD}' +",
    "  '\\\\u{90000}-\\\\u{9FFFD}\\\\u{A0000}-\\\\u{AFFFD}\\\\u{B0000}-\\\\u{BFFFD}\\\\u{C0000}-\\\\u{CFFFD}' +",
    "  '\\\\u{D0000}-\\\\u{DFFFD}\\\\u{E1000}-\\\\u{EFFFD}'",
    `const _iprivate = '\\\\uE000-\\\\uF8FF\\\\u{F0000}-\\\\u{FFFFD}\\\\u{100000}-\\\\u{10FFFD}'`,
    'const _uriGrammar = (extraUnreserved: string, privateQuery = ""): { uri: string; reference: string } => {',
    '  const unreserved = `A-Za-z0-9\\\\-._~${extraUnreserved}`',
    "  const scheme = '[A-Za-z][A-Za-z0-9+\\\\-.]*'",
    '  const pchar = `(?:[${unreserved}${_subDelims}:@]|${_pctEncoded})`',
    '  const segment = `${pchar}*`',
    '  const segmentNz = `${pchar}+`',
    '  const segmentNzNc = `(?:[${unreserved}${_subDelims}@]|${_pctEncoded})+`',
    '  const userinfo = `(?:[${unreserved}${_subDelims}:]|${_pctEncoded})*`',
    '  const ipvFuture = `[Vv][0-9A-Fa-f]+\\\\.[${unreserved}${_subDelims}:]+`',
    '  const ipLiteral = `\\\\[(?:${_ipv6Body}|${ipvFuture})\\\\]`',
    '  const regName = `(?:[${unreserved}${_subDelims}]|${_pctEncoded})*`',
    '  const host = `(?:${ipLiteral}|${_ipv4Octets}|${regName})`',
    '  const authority = `(?:${userinfo}@)?${host}(?::\\\\d*)?`',
    '  const pathAbempty = `(?:/${segment})*`',
    '  const pathAbsolute = `/(?:${segmentNz}(?:/${segment})*)?`',
    '  const pathRootless = `${segmentNz}(?:/${segment})*`',
    '  const pathNoscheme = `${segmentNzNc}(?:/${segment})*`',
    '  const hierPart = `(?://${authority}${pathAbempty}|${pathAbsolute}|${pathRootless}|)`',
    '  const relativePart = `(?://${authority}${pathAbempty}|${pathAbsolute}|${pathNoscheme}|)`',
    '  const query = `(?:\\\\?(?:${pchar}|[/?${privateQuery}])*)?`',
    '  const fragment = `(?:#(?:${pchar}|[/?])*)?`',
    '  return {',
    '    uri: `^${scheme}:${hierPart}${query}${fragment}$`,',
    '    reference: `^(?:${scheme}:${hierPart}|${relativePart})${query}${fragment}$`,',
    '  }',
    '}',
    'const _asciiUri = _uriGrammar("")',
    'const _iriUri = _uriGrammar(_ucschar, _iprivate)',
  ].join('\n'),
  _isDate: [
    'const _dateShape = /^(\\d\\d\\d\\d)-(\\d\\d)-(\\d\\d)$/',
    'const _daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]',
    'const _isLeapYear = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)',
    'const _isDate = (value: string): boolean => {',
    '  const matches = _dateShape.exec(value)',
    '  if (matches === null) return false',
    '  const year = +(matches[1] as string)',
    '  const month = +(matches[2] as string)',
    '  const day = +(matches[3] as string)',
    '  if (month < 1 || month > 12 || day < 1) return false',
    '  return day <= (month === 2 && _isLeapYear(year) ? 29 : (_daysInMonth[month] as number))',
    '}',
  ].join('\n'),
  _timeCheck: [
    'const _timeShape = /^(\\d\\d):(\\d\\d):(\\d\\d)(?:\\.\\d+)?(?:([Zz])|([+-])(\\d\\d):(\\d\\d))?$/',
    'const _timeCheck =',
    '  (requireOffset: boolean) =>',
    '  (value: string): boolean => {',
    '    const matches = _timeShape.exec(value)',
    '    if (matches === null) return false',
    '    const hour = +(matches[1] as string)',
    '    const minute = +(matches[2] as string)',
    '    const second = +(matches[3] as string)',
    '    const zulu = matches[4] !== undefined',
    '    const offsetSign = matches[5] === "-" ? -1 : 1',
    '    const hasOffset = zulu || matches[5] !== undefined',
    '    if (requireOffset && !hasOffset) return false',
    '    const offsetHours = +(matches[6] ?? 0)',
    '    const offsetMinutes = +(matches[7] ?? 0)',
    '    if (hour > 23 || minute > 59 || second > 60 || offsetHours > 23 || offsetMinutes > 59) return false',
    '    if (second < 60) return true',
    '    const utcMinute = minute - offsetMinutes * offsetSign',
    '    const utcHour = hour - offsetHours * offsetSign - (utcMinute < 0 ? 1 : 0)',
    '    return (utcHour === 23 || utcHour === -1) && (utcMinute === 59 || utcMinute === -1)',
    '  }',
    'const _dateTimeSeparator = /t|\\s/i',
    'const _dateTimeCheck = (time: (value: string) => boolean) => (value: string) => {',
    '  const parts = value.split(_dateTimeSeparator)',
    '  return parts.length === 2 && _isDate(parts[0] as string) && time(parts[1] as string)',
    '}',
  ].join('\n'),
  _emailPattern: [
    `const _asciiAtom = "[a-zA-Z0-9!#$%&'*+/=?^_\`{|}~-]"`,
    `const _idnAtom = "[\\\\p{L}\\\\p{N}\\\\p{M}!#$%&'*+/=?^_\`{|}~-]"`,
    'const _emailPattern = (atom: string, label: string, unicode: boolean): RegExp =>',
    '  new RegExp(`^${atom}+(?:\\\\.${atom}+)*@(?:${label}\\\\.)+${label}$`, unicode ? "u" : "")',
  ].join('\n'),
}

/** What each shared helper itself needs, so a fragment pulls in its whole chain. */
const SHARED_NEEDS: Readonly<Record<string, readonly string[]>> = {
  _ipv6Body: ['_ipv4Octets'],
  _uriGrammar: ['_ipv4Octets', '_ipv6Body'],
  _timeCheck: ['_isDate'],
}

const regexFragment = (family: 'string' | 'number', pattern: string, needs?: readonly string[]): FormatFragment => ({
  family,
  ...(needs === undefined ? {} : { needs }),
  source: (name) => `const ${name} = (value: string): boolean => ${pattern}.test(value)`,
})

const builtFragment = (family: 'string' | 'number', expression: string, needs: readonly string[]): FormatFragment => ({
  family,
  needs,
  source: (name) => `const ${name} = ${expression}`,
})

/**
 * Every format the generator can emit a check for — the same set
 * `@amritk/runtime-validators` enforces, and deliberately not a subset: a
 * generator that silently skipped some would be the exact footgun this closes.
 */
export const FORMAT_FRAGMENTS: Readonly<Record<string, FormatFragment>> = {
  email: builtFragment(
    'string',
    '_emailPattern(_asciiAtom, _asciiLabel, false).test.bind(_emailPattern(_asciiAtom, _asciiLabel, false))',
    ['_emailPattern', '_asciiLabel'],
  ),
  'idn-email': builtFragment(
    'string',
    '_emailPattern(_idnAtom, _idnLabel, true).test.bind(_emailPattern(_idnAtom, _idnLabel, true))',
    ['_emailPattern', '_idnLabel'],
  ),
  date: builtFragment('string', '_isDate', ['_isDate']),
  time: builtFragment('string', '_timeCheck(true)', ['_timeCheck']),
  'iso-time': builtFragment('string', '_timeCheck(false)', ['_timeCheck']),
  'date-time': builtFragment('string', '_dateTimeCheck(_timeCheck(true))', ['_timeCheck']),
  'iso-date-time': builtFragment('string', '_dateTimeCheck(_timeCheck(false))', ['_timeCheck']),
  duration: builtFragment(
    'string',
    [
      '((): ((value: string) => boolean) => {',
      "  const second = '\\\\d+S'",
      '  const minute = `\\\\d+M(?:${second})?`',
      '  const hour = `\\\\d+H(?:${minute})?`',
      '  const time = `T(?:${hour}|${minute}|${second})`',
      "  const day = '\\\\d+D'",
      '  const month = `\\\\d+M(?:${day})?`',
      '  const year = `\\\\d+Y(?:${month})?`',
      '  const date = `(?:${year}|${month}|${day})(?:${time})?`',
      '  const pattern = new RegExp(`^P(?:${date}|${time}|\\\\d+W)$`)',
      '  return (value) => pattern.test(value)',
      '})()',
    ].join('\n'),
    [],
  ),
  uuid: regexFragment('string', '/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/'),
  uri: builtFragment('string', '((re) => (value: string) => re.test(value))(new RegExp(_asciiUri.uri))', [
    '_uriGrammar',
  ]),
  'uri-reference': builtFragment(
    'string',
    '((re) => (value: string) => re.test(value))(new RegExp(_asciiUri.reference))',
    ['_uriGrammar'],
  ),
  iri: builtFragment('string', '((re) => (value: string) => re.test(value))(new RegExp(_iriUri.uri, "u"))', [
    '_uriGrammar',
  ]),
  'iri-reference': builtFragment(
    'string',
    '((re) => (value: string) => re.test(value))(new RegExp(_iriUri.reference, "u"))',
    ['_uriGrammar'],
  ),
  url: builtFragment(
    'string',
    '((re) => (value: string) => /^(?:https?|ftp):\\/\\/[^/?#]/.test(value) && re.test(value))(new RegExp(_asciiUri.uri))',
    ['_uriGrammar'],
  ),
  'uri-template': builtFragment(
    'string',
    [
      '((): ((value: string) => boolean) => {',
      '  const literal = `(?:[!#$&(-;=?-\\\\[\\\\]_a-z~${_ucschar}${_iprivate}]|${_pctEncoded})`',
      '  const varchar = `(?:[A-Za-z0-9_]|${_pctEncoded})`',
      '  const varname = `${varchar}(?:\\\\.?${varchar})*`',
      "  const modifier = '(?::[1-9]\\\\d{0,3}|\\\\*)?'",
      '  const varspec = `${varname}${modifier}`',
      '  const expression = `\\\\{[+#./;?&=,!@|]?${varspec}(?:,${varspec})*\\\\}`',
      '  const pattern = new RegExp(`^(?:${literal}|${expression})*$`, "iu")',
      '  return (value) => pattern.test(value)',
      '})()',
    ].join('\n'),
    ['_uriGrammar'],
  ),
  'json-pointer': regexFragment('string', '/^(?:\\/(?:[^~/]|~[01])*)*$/'),
  'json-pointer-uri-fragment': regexFragment('string', '/^#(?:\\/(?:[^~/]|~[01])*)*$/'),
  'relative-json-pointer': regexFragment('string', '/^(?:0|[1-9]\\d*)(?:#|(?:\\/(?:[^~/]|~[01])*)*)$/'),
  hostname: builtFragment(
    'string',
    '((re) => (value: string) => re.test(value))(new RegExp(`^(?=.{1,253}$)${_asciiLabel}(?:\\\\.${_asciiLabel})*$`))',
    ['_asciiLabel'],
  ),
  'idn-hostname': builtFragment(
    'string',
    '((re) => (value: string) => re.test(value))(new RegExp(`^(?=.{1,253}$)${_idnLabel}(?:\\\\.${_idnLabel})*$`, "u"))',
    ['_idnLabel'],
  ),
  ipv4: builtFragment('string', '((re) => (value: string) => re.test(value))(new RegExp(`^${_ipv4Octets}$`))', [
    '_ipv4Octets',
  ]),
  ipv6: builtFragment('string', '((re) => (value: string) => re.test(value))(new RegExp(`^${_ipv6Body}$`))', [
    '_ipv6Body',
  ]),
  regex: {
    family: 'string',
    source: (name) =>
      `const ${name} = (value: string): boolean => {\n  try {\n    new RegExp(value)\n    return true\n  } catch {\n    return false\n  }\n}`,
  },
  byte: regexFragment('string', '/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/'),
  binary: { family: 'string', source: (name) => `const ${name} = (_value: string): boolean => true` },
  password: { family: 'string', source: (name) => `const ${name} = (_value: string): boolean => true` },
  int32: {
    family: 'number',
    source: (name) =>
      `const ${name} = (value: number): boolean => Number.isInteger(value) && value >= -(2 ** 31) && value <= 2 ** 31 - 1`,
  },
  int64: { family: 'number', source: (name) => `const ${name} = (value: number): boolean => Number.isInteger(value)` },
  float: { family: 'number', source: (name) => `const ${name} = (_value: number): boolean => true` },
  double: { family: 'number', source: (name) => `const ${name} = (_value: number): boolean => true` },
}

/** The JSON type a format asserts about, or `undefined` when nothing defines it. */
export const formatFamily = (format: string): 'string' | 'number' | undefined =>
  Object.hasOwn(FORMAT_FRAGMENTS, format) ? (FORMAT_FRAGMENTS[format] as FormatFragment).family : undefined

/**
 * The source of a `formats.ts` module defining a check for each format in
 * `formats`, or `''` when none of them is one this generator knows.
 *
 * Only the formats the schema actually names are emitted, along with whichever
 * shared helpers those need — so a schema declaring one `uuid` gets one regex
 * rather than the whole table.
 */
export const emitFormatModule = (formats: Iterable<string>): string => {
  const wanted = [...new Set(formats)].filter((format) => Object.hasOwn(FORMAT_FRAGMENTS, format)).sort()
  if (wanted.length === 0) return ''

  const needed = new Set<string>()
  const require = (helper: string): void => {
    if (needed.has(helper)) return
    needed.add(helper)
    for (const nested of SHARED_NEEDS[helper] ?? []) require(nested)
  }
  for (const format of wanted) {
    for (const helper of (FORMAT_FRAGMENTS[format] as FormatFragment).needs ?? []) require(helper)
  }

  // Emitted in declaration order, so a helper always precedes what reads it.
  const helpers = Object.keys(SHARED).filter((helper) => needed.has(helper))
  const checks = wanted.map((format) => {
    const fragment = FORMAT_FRAGMENTS[format] as FormatFragment
    const name = formatCheckName(format)
    return `${fragment.source(name)}\nexport { ${name} }`
  })

  return [
    '/**',
    ' * `format` checks for the formats this schema declares.',
    ' *',
    ' * Generated alongside the validators that call them, so the emitted code',
    ' * stays dependency-free. Behaviour matches `@amritk/runtime-validators` run',
    ' * with the same formats enabled — a differential test over the official',
    " * suite's optional/format corpus holds the two together.",
    ' */',
    '',
    ...helpers.map((helper) => SHARED[helper] as string),
    '',
    ...checks,
    '',
  ].join('\n')
}
