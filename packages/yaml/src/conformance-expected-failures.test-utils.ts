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

  // ---------------------------------------------------------------------------
  // rejects: tabs the spec allows
  //
  // The mirror image. `peekLine` reports any tab in a line's leading whitespace,
  // which over-reports a tab that is separation rather than indentation.
  // ---------------------------------------------------------------------------
  '6CA3': 'rejects: tab indenting a flow collection continuation line',
  'DK95/0': 'rejects: tab that follows the block indentation rather than forming it',
  Q5MG: 'rejects: tab before a flow mapping on a continuation line',

  // ---------------------------------------------------------------------------
  // accepts: a flow collection indented back to its parent's column
  //
  // A flow collection written across lines must keep its continuation lines
  // deeper than the block that holds it. This parser does not track a block
  // indent inside `[`/`{` — flow scanning is deliberately delimiter-driven, not
  // column-driven — so a continuation at the parent's column reads the same as
  // a properly indented one.
  // ---------------------------------------------------------------------------
  '9C9N': 'accepts: a wrongly indented flow sequence',
  'VJP3/0': 'accepts: a flow mapping whose continuation lines sit at the parent indent',

  // ---------------------------------------------------------------------------
  // rejects: block shapes we mis-scan
  //
  // The document is left partly unconsumed, which the document-end check reports
  // rather than dropping silently. The report is the improvement; parsing this
  // shape correctly is not in scope.
  // ---------------------------------------------------------------------------
  WZ62: 'rejects: a flow collection holding only empty content',

  // ---------------------------------------------------------------------------
  // rejects: by design
  // ---------------------------------------------------------------------------
  '2JQS': 'rejects: two entries with an empty key, which `uniqueKeys` treats as duplicates',

  // ---------------------------------------------------------------------------
  // output: extended tags project to richer JavaScript types
  //
  // `!!binary` becomes a `Uint8Array`, `!!set` a `Set`, and `!!omap` a `Map` —
  // all three matching `yaml` (eemeli) — where the suite's JSON expectation is
  // the plain string or object those serialize to. A deliberate, documented
  // difference, and the reason these three read as "failures" here.
  // ---------------------------------------------------------------------------
  '565N': 'output: `!!binary` projects to `Uint8Array`, not the base64 string',
  '2XXW': 'output: `!!set` projects to a `Set`, not a plain object',
  J7PZ: 'output: `!!omap` projects to a `Map`, not an array of single-pair objects',
}
