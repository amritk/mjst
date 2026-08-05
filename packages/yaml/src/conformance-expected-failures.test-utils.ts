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
 *
 * What is left is the irreducible part: one case that turns on a deliberate
 * option default, and three where a richer JavaScript type is the better answer
 * than the one JSON can write down.
 */
export const EXPECTED_FAILURES: Record<string, string> = {
  // ---------------------------------------------------------------------------
  // rejects: by design
  //
  // `: a` / `: b` is two entries whose keys are both empty, which the spec's own
  // "keys are unique" rule (§3.2.1.1) makes a duplicate — but the suite only asks
  // that the document *compose*, so it reads as valid there. `uniqueKeys` is on
  // by default because a linter wants the report; `parse(src, { uniqueKeys:
  // false })` accepts this document.
  // ---------------------------------------------------------------------------
  '2JQS': 'rejects: two entries with an empty key, which `uniqueKeys` treats as duplicates',

  // `{ &a [a, &b b]: *b, *a : [c, *b, d] }` keys the mapping twice by the same
  // sequence — once written out, once through the alias that points at it — so
  // both keys render `[ a, b ]` and the pairs collapse into one in any JavaScript
  // object. That is the same "keys are unique" rule as `2JQS`, and the same
  // answer: the report is what a linter wants, and `uniqueKeys: false` accepts it.
  X38W: 'rejects: a sequence key and an alias to it render alike, which `uniqueKeys` treats as duplicates',

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
