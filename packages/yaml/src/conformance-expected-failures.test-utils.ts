/**
 * The YAML test suite cases this parser does not handle, each with the reason.
 *
 * This package implements a *subset* of YAML 1.2 (see the README's Scope
 * section), so this list describes that subset rather than being a to-do list.
 * It exists so the subset is a **known** one: `conformance.test.ts` fails if a
 * case listed here starts passing (the entry must be removed) or if a case not
 * listed here starts failing (a regression). The boundary cannot move silently.
 *
 * Keys are suite case ids — `SKE5` for a single-case file, `Y79Y/3` for the
 * fourth case of a multi-case one. Look one up at
 * https://matrix.yaml.info/details/<id>.html
 *
 * The three shapes of gap:
 *  - **accepts** — an invalid document parsed without complaint. Costs a
 *    diagnostic; never produces wrong data.
 *  - **rejects** — a valid document reported as an error.
 *  - **output** — parses cleanly but produces a different value.
 */
export const EXPECTED_FAILURES: Record<string, string> = {
  // ---------------------------------------------------------------------------
  // accepts: tabs where the spec forbids them
  //
  // Tab-in-indentation is reported (`TAB_INDENT`), but the spec's finer rules —
  // tabs inside block scalar indentation, after an indicator, or in a flow
  // collection's continuation lines — are not modelled. Catching those means
  // threading a tab check through every scanner, which the block-mapping hot
  // path would pay for on every line.
  // ---------------------------------------------------------------------------
  'Y79Y/0': 'accepts: tab after a `-` sequence indicator',
  'Y79Y/3': 'accepts: tab in block scalar indentation',
  'Y79Y/4': 'accepts: tab in block scalar indentation',
  'Y79Y/5': 'accepts: tab in block scalar indentation',
  'Y79Y/6': 'accepts: tab before a block mapping value',
  'Y79Y/7': 'accepts: tab in flow collection indentation',
  'Y79Y/8': 'accepts: tab in flow collection indentation',
  'Y79Y/9': 'accepts: tab in flow collection indentation',
  'DK95/1': 'accepts: tab used as indentation inside a block scalar',

  // ---------------------------------------------------------------------------
  // rejects: tabs the spec allows
  //
  // The mirror image. `peekLine` reports any tab in a line's leading whitespace,
  // which over-reports a tab that is separation rather than indentation.
  // ---------------------------------------------------------------------------
  '6CA3': 'rejects: tab indenting a flow collection continuation line',
  'DK95/0': 'rejects: tab that follows the block indentation rather than forming it',
  Q5MG: 'rejects: tab before a flow mapping on a continuation line',
  UV7Q: 'rejects: tab separating indentation from content',

  // ---------------------------------------------------------------------------
  // accepts: directive and document-marker rules
  //
  // `%YAML` and `%TAG` are read — handles resolve, versions are reported — but
  // the stream-level grammar around them is not enforced: that a directive must
  // precede a `---`, that a document must be closed by `...` before the next
  // document's directives, and that handles do not carry across documents.
  // ---------------------------------------------------------------------------
  '9HCY': 'accepts: directives after a document with no `...` footer',
  B63P: 'accepts: a directive with no document following it',
  EB22: 'accepts: a directive with no `...` closing the previous document',
  RHX7: 'accepts: `%YAML` with no document-end marker before it',
  SF5V: 'accepts: a duplicate `%YAML` directive (reported as a warning, not an error)',
  H7TQ: 'accepts: trailing words on a `%YAML` directive',
  'MUS6/0': 'accepts: a malformed `%YAML` version',
  'MUS6/1': 'accepts: a malformed `%YAML` version',
  '9MMA': 'accepts: a directive with no document body',
  QLJ7: 'accepts: a tag handle used in a later document than the one declaring it',
  '3HFZ': 'accepts: content after a `...` document-end marker',
  LHL4: 'accepts: a malformed tag',
  U99R: 'accepts: a comma inside a tag',

  // ---------------------------------------------------------------------------
  // accepts: multi-line implicit keys
  //
  // An implicit key must fit on one line and stay under 1024 characters. Neither
  // is checked: `findKeyColon` deliberately looks at a single line, and the check
  // needs lookahead the hot path does not do.
  // ---------------------------------------------------------------------------
  '7LBH': 'accepts: a double-quoted implicit key spanning lines',
  D49Q: 'accepts: a single-quoted implicit key spanning lines',
  JKF3: 'accepts: an unindented multi-line double-quoted block key',
  DK4H: 'accepts: an implicit key followed by a line break before its value',
  ZXT5: 'accepts: an implicit key followed by a line break and an adjacent value',
  C2SP: 'accepts: a flow mapping key with its `:` on the next line',
  QB6E: 'accepts: a wrongly indented multi-line quoted scalar',

  // ---------------------------------------------------------------------------
  // accepts: flow-collection syntax errors
  //
  // The flow parsers recover rather than diagnose: a missing comma, a stray
  // comment, or a document marker inside a flow collection is absorbed.
  // ---------------------------------------------------------------------------
  '9C9N': 'accepts: a wrongly indented flow sequence',
  '9JBA': 'accepts: a comment directly after a flow sequence closes',
  CML9: 'accepts: a missing comma between flow entries',
  CVW2: 'accepts: a comment directly after a comma',
  G5U8: 'accepts: bare `-` entries in a flow sequence',
  N782: 'accepts: a document marker inside a flow collection',
  YJV2: 'accepts: a `-` in a flow sequence',
  'VJP3/0': 'accepts: a flow mapping continued over lines without a comma',

  // ---------------------------------------------------------------------------
  // accepts: scalar and block-scalar syntax errors
  // ---------------------------------------------------------------------------
  '55WF': 'accepts: an invalid escape in a double-quoted scalar',
  HRE5: 'accepts: an escaped single quote inside a double-quoted scalar',
  SU5Z: 'accepts: a comment with no whitespace before it after a double-quoted scalar',
  X4QW: 'accepts: a comment with no whitespace before it after a block scalar indicator',
  S4GJ: 'accepts: text after a block scalar indicator',
  '2G84/0': 'accepts: repeated block scalar chomping indicators',
  '2G84/1': 'accepts: repeated block scalar indentation indicators',
  '5LLU': 'accepts: a wrongly indented block scalar line following blank lines',
  S98Z: 'accepts: a block scalar line less indented than its first content line',
  W9L4: 'accepts: a literal block scalar whose first line is more indented',
  '5TRB': 'accepts: a `---` marker inside a double-quoted scalar',
  RXY3: 'accepts: a `...` marker inside a single-quoted scalar',
  BF9H: 'accepts: a trailing comment inside a multi-line plain scalar',
  BS4K: 'accepts: a comment between the lines of a plain scalar',

  // ---------------------------------------------------------------------------
  // accepts: block structure errors
  //
  // The block parsers resolve ambiguity by picking an interpretation rather than
  // reporting one, so a mis-indented or malformed block reads as some other
  // valid shape instead of an error.
  // ---------------------------------------------------------------------------
  '2CMS': 'accepts: a mapping inside a multi-line plain scalar',
  HU3P: 'accepts: a mapping inside a plain scalar',
  ZCZ6: 'accepts: a mapping inside a single-line plain value',
  '5U3A': 'accepts: a sequence on the same line as its mapping key',
  EW3V: 'accepts: a wrongly indented mapping entry',
  '9KBC': 'accepts: a mapping starting on the `---` line',
  CXX2: 'accepts: an anchor on the `---` line of a mapping',
  SY6V: 'accepts: an anchor before a sequence entry on the same line',
  '4JVG': 'accepts: two anchors on one scalar',
  SR86: 'accepts: an anchor and an alias on the same node',
  SU74: 'accepts: an anchor and an alias used together as a mapping key',

  // ---------------------------------------------------------------------------
  // rejects: node properties on block mapping keys
  //
  // A block mapping key is scanned as text up to its `:`, so `&a key:` and
  // `!!str key:` keep the property inside the key rather than applying it. When
  // that anchor is later aliased, the alias has nothing to resolve against and
  // reports `UNRESOLVED_ALIAS`. Fixing it means running `scanProps` on every
  // mapping key — the hottest path in the parser.
  // ---------------------------------------------------------------------------
  E76Z: 'rejects: an anchor declared on a block mapping key, then aliased',
  HMQ5: 'rejects: a tag and anchor on a block mapping key, then aliased',
  '2SXE': 'rejects: an anchor whose name contains a `:`',

  // ---------------------------------------------------------------------------
  // rejects: block shapes we mis-scan
  //
  // Each leaves part of the document unconsumed, which the document-end check
  // reports rather than dropping silently. The report is the improvement;
  // parsing these shapes correctly is not in scope.
  // ---------------------------------------------------------------------------
  '57H4': 'rejects: block collection nodes whose content sits at the parent indent',
  M5C3: 'rejects: block scalar nodes whose content sits at the parent indent',
  SKE5: 'rejects: a zero-indented sequence introduced by an anchor on its own line',
  DK3J: 'rejects: a zero-indented block scalar holding a line that looks like a comment',
  AB8U: 'rejects: a multi-line plain scalar whose continuation looks like a sequence entry',
  WZ62: 'rejects: a flow collection holding only empty content',

  // ---------------------------------------------------------------------------
  // rejects: by design
  // ---------------------------------------------------------------------------
  '2JQS': 'rejects: two entries with an empty key, which `uniqueKeys` treats as duplicates',

  // ---------------------------------------------------------------------------
  // output: block scalar folding and chomping
  //
  // The literal/folded scanner handles the common shapes but differs on the
  // spec's edge cases: indentation indicators combined with leading blank lines,
  // trailing-break chomping when the block ends the document, and the
  // 1.3-flavoured re-indentation examples.
  // ---------------------------------------------------------------------------
  '4Q9F': 'output: folded scalar trailing break',
  '6FWR': 'output: `keep` chomping of trailing blank lines',
  '6JQW': 'output: literal scalar containing a document marker',
  '96L6': 'output: folded scalar line folding',
  MJS9: 'output: folded scalar block folding',
  B3HG: 'output: folded scalar with a trailing more-indented line',
  T26H: 'output: literal content with leading blank lines',
  T5N4: 'output: literal scalar with leading blank lines',
  A2M4: 'output: indentation indicator combined with leading spaces',
  FP8R: 'output: zero-indented block scalar',
  R4YG: 'output: block indentation indicator with a more-indented first line',
  '2G84/2': 'output: block scalar with both chomping and indentation indicators',
  ZF4X: 'output: nested mapping whose values are block scalars',

  // ---------------------------------------------------------------------------
  // output: quoted scalar folding
  // ---------------------------------------------------------------------------
  NP9H: 'output: double-quoted line breaks with escaped continuations',
  Q8AD: 'output: double-quoted line breaks, 1.3 form',
  'DE56/2': 'output: trailing tabs in a double-quoted scalar',
  'DE56/3': 'output: trailing tabs in a double-quoted scalar',

  // ---------------------------------------------------------------------------
  // output: document and directive handling
  // ---------------------------------------------------------------------------
  '27NA': 'output: `%` directive indicator inside content',
  '6LVF': 'output: reserved directives',
  W4TN: 'output: directives split across documents in a stream',
  KSS4: 'output: a scalar written on the `---` line',
  L383: 'output: two scalar documents with trailing comments',
  '9MQT/0': 'output: a scalar document containing `...` in its content',
  K54U: 'output: tab after the document header',

  // ---------------------------------------------------------------------------
  // output: extended tags project to richer JavaScript types
  //
  // `!!binary` becomes a `Uint8Array` (matching `yaml`) where the suite's JSON
  // expectation is the base64 string. A deliberate, documented difference.
  // ---------------------------------------------------------------------------
  '565N': 'output: `!!binary` projects to `Uint8Array`, not the base64 string',

  // ---------------------------------------------------------------------------
  // output: remaining structural differences
  // ---------------------------------------------------------------------------
  '5WE3': 'output: an explicit block key whose value is a sequence at the key indent',
  '4MUZ/2': 'output: a flow mapping key with its `:` on the following line',
  '652Z': 'output: a plain flow key beginning with `?`',
  '74H7': 'output: tags in an implicit mapping',
  '9KAX': 'output: combinations of tags and anchors on the same node',
  '7TMG': 'output: a comment in a flow sequence before the comma',
  'VJP3/1': 'output: a flow mapping continued over several lines',
  ZWK4: 'output: a key with an anchor after a missing explicit mapping value',
}
