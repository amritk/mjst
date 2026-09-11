import type { ExpectedFailures } from '../../../../fixtures/json-schema-test-suite/load-suite'

/**
 * The official suite's **optional** `format` cases the interpreter does not
 * answer, each with the reason.
 *
 * 786 of 861 pass. The 75 below are not a list of formats that go unchecked —
 * every format in the corpus is validated — they are the places where deciding
 * a value needs a Unicode database or a decoder rather than a grammar, plus two
 * one-off edges. For comparison, Ajv with `ajv-formats` passes 729 of the same
 * 861; `format-checks.test.ts` records where the two deliberately differ.
 *
 * Keys are case ids — `<file>/<group description>/<test description>`. Look one
 * up in `fixtures/json-schema-test-suite/draft2020-12/optional/format/<file>`.
 *
 * `format-conformance.test.ts` fails if a case listed here starts passing (the
 * entry must go) or if a case not listed here starts failing (a regression), so
 * this list is exact rather than approximate.
 */
export const EXPECTED_FORMAT_FAILURES: ExpectedFailures = {
  // ---------------------------------------------------------------------------
  // ECMAScript regex: an escape that only the `u` flag rejects
  //
  // `format: "regex"` asks whether the string compiles as an ECMA-262 pattern,
  // and `new RegExp("\\a")` compiles: without the `u` flag `\a` is an identity
  // escape, not an error. Compiling with `u` would answer this case and change the
  // verdict on patterns that are legal without it, which is not a trade worth
  // making for one escape.
  // ---------------------------------------------------------------------------
  'ecmascript-regex.json/\\a is not an ECMA 262 control escape/when used as a pattern':
    'ECMAScript regex: `\\a` is an identity escape without the `u` flag, so it compiles',

  // ---------------------------------------------------------------------------
  // email: RFC 5321 quoted-string local parts and address literals
  //
  // The local part of an address may be a quoted string (`"joe bloggs"@x.com`,
  // `""@iana.org`) and the domain may be an address literal (`joe@[127.0.0.1]`).
  // Both are legal and neither is what anyone types into a signup form, so the
  // check stays the dot-separated-atom shape that catches the mistakes people
  // actually make. Ajv fails the same thirteen cases.
  // ---------------------------------------------------------------------------
  'email.json/validation of e-mail addresses/a quoted string with a space in the local part is valid':
    'email: quoted-string local part / address-literal domain (RFC 5321), out of scope',
  'email.json/validation of e-mail addresses/a quoted string with a double dot in the local part is valid':
    'email: quoted-string local part / address-literal domain (RFC 5321), out of scope',
  'email.json/validation of e-mail addresses/a quoted string with a @ in the local part is valid':
    'email: quoted-string local part / address-literal domain (RFC 5321), out of scope',
  'email.json/validation of e-mail addresses/an IPv4-address-literal after the @ is valid':
    'email: quoted-string local part / address-literal domain (RFC 5321), out of scope',
  'email.json/validation of e-mail addresses/an IPv6-address-literal after the @ is valid':
    'email: quoted-string local part / address-literal domain (RFC 5321), out of scope',
  'email.json/validation of e-mail addresses/an empty quoted string in the local part is valid':
    'email: quoted-string local part / address-literal domain (RFC 5321), out of scope',
  'email.json/validation of e-mail addresses/a quoted string containing only a space in the local part is valid':
    'email: quoted-string local part / address-literal domain (RFC 5321), out of scope',
  'email.json/validation of e-mail addresses/a quoted string with no special characters in the local part is valid':
    'email: quoted-string local part / address-literal domain (RFC 5321), out of scope',
  'email.json/validation of e-mail addresses/a quoted pair in the local part is valid':
    'email: quoted-string local part / address-literal domain (RFC 5321), out of scope',
  'email.json/validation of e-mail addresses/an escaped double quote in the local part is valid':
    'email: quoted-string local part / address-literal domain (RFC 5321), out of scope',
  'email.json/validation of e-mail addresses/an escaped backslash in the local part is valid':
    'email: quoted-string local part / address-literal domain (RFC 5321), out of scope',
  'email.json/validation of e-mail addresses/a single-label domain is valid':
    'email: quoted-string local part / address-literal domain (RFC 5321), out of scope',
  'email.json/validation of e-mail addresses/a lowercase IPv6 tag in an address literal is valid':
    'email: quoted-string local part / address-literal domain (RFC 5321), out of scope',

  // ---------------------------------------------------------------------------
  // hostname: decoding an A-label
  //
  // An `xn--` label is Punycode, and deciding whether it is a *valid* one means
  // decoding it and re-running the IDNA rules over the result. That is a table and
  // a decoder, not a pattern. The U-label rules are checked; the A-label ones are
  // not.
  // ---------------------------------------------------------------------------
  'hostname.json/validation of A-label (punycode) host names/invalid Punycode':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/contains illegal char U+302E Hangul single dot tone mark':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/Begins with a Spacing Combining Mark':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/Begins with a Nonspacing Mark':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/Begins with an Enclosing Mark':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/Exceptions that are DISALLOWED, right-to-left chars':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/Exceptions that are DISALLOWED, left-to-right chars':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  "hostname.json/validation of A-label (punycode) host names/MIDDLE DOT with no preceding 'l'":
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/MIDDLE DOT with nothing preceding':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  "hostname.json/validation of A-label (punycode) host names/MIDDLE DOT with no following 'l'":
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/MIDDLE DOT with nothing following':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/Greek KERAIA not followed by Greek':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/Greek KERAIA not followed by anything':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/Hebrew GERESH not preceded by Hebrew':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/Hebrew GERESH not preceded by anything':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/Hebrew GERSHAYIM not preceded by Hebrew':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/Hebrew GERSHAYIM not preceded by anything':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/KATAKANA MIDDLE DOT with no Hiragana, Katakana, or Han':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/KATAKANA MIDDLE DOT with no other characters':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/Arabic-Indic digits mixed with Extended Arabic-Indic digits':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/ZERO WIDTH JOINER not preceded by Virama':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/ZERO WIDTH JOINER not preceded by anything':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',
  'hostname.json/validation of A-label (punycode) host names/contains "--" in the 3rd and 4th position':
    'hostname: deciding an `xn--` A-label needs Punycode decoding, not a pattern',

  // ---------------------------------------------------------------------------
  // idn-email: the same RFC 5321 shapes, internationalized
  //
  // As `email.json` above: quoted local parts, and the C1/noncharacter code points
  // a quoted part may carry.
  // ---------------------------------------------------------------------------
  'idn-email.json/validation of an internationalized e-mail addresses/a non-ASCII quoted local part is valid':
    'idn-email: quoted-string local part (RFC 5321), out of scope',
  'idn-email.json/validation of an internationalized e-mail addresses/a C1 control in the local part is valid':
    'idn-email: quoted-string local part (RFC 5321), out of scope',
  'idn-email.json/validation of an internationalized e-mail addresses/a noncharacter in the local part is valid':
    'idn-email: quoted-string local part (RFC 5321), out of scope',

  // ---------------------------------------------------------------------------
  // idn-hostname: IDNA2008 tables, the Bidi rule, and the contextual rules
  //
  // Deciding these means shipping the IDNA2008 derived-property table, the Bidi
  // rule from RFC 5893, and the CONTEXTJ/CONTEXTO rules that make MIDDLE DOT legal
  // between two `l`s and illegal elsewhere. That is a Unicode database, not a
  // character class. The label shape and length are checked; membership is not.
  // Ajv does not implement `idn-hostname` at all, so it passes every case here
  // that expects `true` and fails every case that expects `false` — 43/98 against
  // this list's 64/98.
  // ---------------------------------------------------------------------------
  'idn-hostname.json/validation of internationalized host names/contains illegal char U+302E Hangul single dot tone mark':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/invalid Punycode':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/U-label contains "--" in the 3rd and 4th position':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/Exceptions that are PVALID, left-to-right chars':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/Exceptions that are PVALID, right-to-left chars':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/Exceptions that are DISALLOWED, right-to-left chars':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/Exceptions that are DISALLOWED, left-to-right chars':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  "idn-hostname.json/validation of internationalized host names/MIDDLE DOT with surrounding 'l's":
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/Greek KERAIA followed by Greek':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/Hebrew GERESH preceded by Hebrew':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/Hebrew GERSHAYIM preceded by Hebrew':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/KATAKANA MIDDLE DOT with Hiragana':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/KATAKANA MIDDLE DOT with Katakana':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/KATAKANA MIDDLE DOT with Han':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/Arabic-Indic digits mixed with Extended Arabic-Indic digits':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/ZERO WIDTH JOINER preceded by Virama':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/ZERO WIDTH NON-JOINER preceded by Virama':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/ZERO WIDTH NON-JOINER not preceded by Virama but matches regexp':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/a zero width space is ignored by the mapping':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/a label of only Arabic-Indic digits is invalid':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/Bidi domain name with a digit-first label is invalid':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/label starting with a digit before a right-to-left letter is invalid':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/left-to-right label containing a right-to-left letter is invalid':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/right-to-left label mixing both digit types is invalid':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/A-label that decodes to a disallowed code point is invalid':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/A-label that decodes to a Bidi rule violation is invalid':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/a U-label whose A-label form is longer than 63 octets is invalid':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',
  'idn-hostname.json/validation of internationalized host names/non-canonical Punycode that does not re-encode to itself is invalid':
    'idn-hostname: needs the IDNA2008 property tables / Bidi / contextual rules',

  // ---------------------------------------------------------------------------
  // idn-hostname: alternate label separators
  //
  // IDNA maps the ideographic, fullwidth and halfwidth full stops onto `.` before
  // splitting labels, so `a。b` is a two-label name. Mapping is the step this check
  // does not do.
  // ---------------------------------------------------------------------------
  'idn-hostname.json/validation of separators in internationalized host names/ideographic full stop as label separator':
    'idn-hostname: IDNA maps alternate full stops to `.` before splitting labels',
  'idn-hostname.json/validation of separators in internationalized host names/fullwidth full stop as label separator':
    'idn-hostname: IDNA maps alternate full stops to `.` before splitting labels',
  'idn-hostname.json/validation of separators in internationalized host names/halfwidth ideographic full stop as label separator':
    'idn-hostname: IDNA maps alternate full stops to `.` before splitting labels',
  'idn-hostname.json/validation of separators in internationalized host names/label too long if separator ignored (ideographic full stop)':
    'idn-hostname: IDNA maps alternate full stops to `.` before splitting labels',
  'idn-hostname.json/validation of separators in internationalized host names/label too long if separator ignored (fullwidth full stop)':
    'idn-hostname: IDNA maps alternate full stops to `.` before splitting labels',
  'idn-hostname.json/validation of separators in internationalized host names/label too long if separator ignored (halfwidth ideographic full stop)':
    'idn-hostname: IDNA maps alternate full stops to `.` before splitting labels',

  // ---------------------------------------------------------------------------
  // uri-template: one literal character class edge
  //
  // A single case over which code points a literal admits.
  // ---------------------------------------------------------------------------
  'uri-template.json/format: uri-template/an apostrophe in a literal is valid':
    'uri-template: literal character-class edge case',
}
