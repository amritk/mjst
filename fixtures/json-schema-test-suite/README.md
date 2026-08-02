# JSON Schema Test Suite

The official [JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite),
vendored — the corpus every JSON Schema validator in every language is measured
on. Four packages in this monorepo consume schemas, and all four are held to it
(see the `*conformance*` tests in each):

| Package | What is measured | Rate |
| --- | --- | --- |
| `@amritk/runtime-validators` | `validate` / `validateGuard` verdicts | **1299 / 1299 (100%)** |
| `@amritk/generate-validators` | generated predicate validators | 1238 / 1299 (95.3%) |
| `@amritk/generate-parsers` | strict parsers — generated, linked, executed | 1222 / 1299 (94.1%) |
| `@amritk/resolve-refs` | verdict preserved after inlining (`$ref` corpus) | **170 / 170 (100%)** |

`resolve-refs` is scored against the reference-carrying cases the interpreter
answers correctly, which is the population where a resolution bug is visible at
all — so its denominator moves as `runtime-validators` improves.

Each suite carries an expected-failure list naming every case it does not pass
and why, and fails when a case moves in **either** direction — a regression
breaks the build, and so does a case that starts passing while its entry stays
behind. The boundary cannot move silently.

## What is vendored

`draft2020-12/` — the suite's **required** tests for Draft 2020-12: 46 files,
383 groups, 1299 cases, byte-for-byte as published.

`remotes/` — the documents those tests reference by URI. Upstream they are served
over HTTP at `http://localhost:1234/`, which is the protocol the suite expects an
implementation to follow; `remotes/draft2020-12/integer.json` is
`http://localhost:1234/draft2020-12/integer.json`. Nothing here fetches anything,
so a suite that wants these hands them to the package under test through whatever
API it offers for supplying documents it did not load itself.

Deliberately not vendored:

- **`optional/`** — the suite's own name for behavior an implementation may
  decline: `format` assertion, arbitrary-precision numbers, ECMAScript regex
  corner cases. The required set is the bar implementations report against.
- **Other drafts** — the packages target 2020-12; draft-07 input is upgraded to
  it before anything sees it.

| Path | Source | License |
| --- | --- | --- |
| `draft2020-12/*.json` | [`json-schema-org/JSON-Schema-Test-Suite`](https://github.com/json-schema-org/JSON-Schema-Test-Suite) — `tests/draft2020-12/*.json` | MIT (© 2012 Julian Berman) |
| `remotes/draft2020-12/**` | same repository — `remotes/draft2020-12/**` | MIT (© 2012 Julian Berman) |

To refresh, re-fetch the same files from upstream and commit the result. A case
whose `description` changed upstream surfaces as an unknown expected-failure key,
which is the intended way to notice.

## Using it from a test

`load-suite.ts` flattens the corpus and carries the bookkeeping the four suites
share:

```ts
import { compareToExpected, conformanceRate, loadSuiteCases } from '../../fixtures/json-schema-test-suite/load-suite'

const results = new Map(loadSuiteCases().map((testCase) => [testCase.key, check(testCase)]))
const { unexpected, stale } = compareToExpected(results, EXPECTED_FAILURES)
```

A case key is `<file>/<group description>/<test description>`. An expected-failure
entry may use a `/`-bounded prefix of one — a whole group, or a whole file — when
many cases fall to a single cause; a prefix that stops covering any failure is
reported as stale, so it cannot outlive the gap it describes.

These files live outside any package's `src/` (and outside every published
`files` list), so none of this is shipped.
