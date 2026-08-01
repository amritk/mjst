import type { ExpectedFailures } from '../../../fixtures/json-schema-test-suite/load-suite'

/**
 * The official JSON Schema Test Suite cases where resolution does not preserve
 * the document's meaning, each with the reason.
 *
 * `conformance.test.ts` fails if a case listed here starts passing (the entry
 * must go) or if a case not listed here starts failing (a regression), so the
 * boundary cannot move silently.
 *
 * Keys are case ids — `<file>/<group description>/<test description>` — or a
 * `/`-bounded prefix of one. Look one up in
 * `fixtures/json-schema-test-suite/draft2020-12/<file>`.
 */
export const EXPECTED_FAILURES: ExpectedFailures = {
  // ---------------------------------------------------------------------------
  // `$ref` in a value position
  //
  // `{ "enum": [ { "$ref": "#/$defs/a_string" } ] }` references nothing: `enum`
  // holds *instances*, and one of them happens to be an object with a `$ref` key.
  // The resolver walks the document structurally, so it inlines that object and
  // turns "the enum containing `{"$ref": …}`" into "the enum containing
  // `{"type": "string"}`" — a different document in both directions. The suite
  // carries this group under exactly that name.
  //
  // Closing it means knowing which keywords take schemas and which take values
  // (`enum`, `const`, `default`, `examples`) rather than treating every object
  // with a `$ref` key as a reference.
  // ---------------------------------------------------------------------------
  'ref.json/naive replacement of $ref with its destination is not correct':
    'value position: a `$ref`-shaped object inside `enum` is data, not a reference, and is inlined anyway',
}
