---
'@amritk/yaml': minor
'@amritk/lint': patch
---

Read tabs by the column they sit at, hold a flow collection to its parent's
indentation, and pin JSON as the superset it is

YAML 1.2 test suite conformance goes from **384/402 (95.5%) to 398/402 (99.0%)**.
What is left is four cases where the right answer is not the suite's — one
duplicate-key case that turns on the `uniqueKeys` default, and three tags that
project to a `Uint8Array`/`Set`/`Map` — so this closes the boundary rather than
moving it. Parse throughput is unchanged: an order-balanced A/B over the bench
fixtures lands every case inside run-to-run noise (medians −3% to +1.6% against a
4–6% CV, with min-of-runs favouring the new code).

**A tab is only an error where indentation belongs.** Indentation in YAML is
spaces (`s-indent ::= s-space × n`), but a tab *past* the indentation is ordinary
separation — and the two are told apart only by the column the tab sits at.
`peekLine` reported any leading tab at all, which cut both ways: it rejected three
valid documents (`\t[…]` and `\t{}` at the document root, and a `foo:` whose value
line reads `⟨space⟩⟨tab⟩bar`) while missing the tabs that really are indentation.
Every caller knows the column its line owes, so it now passes it in, and the same
rule is applied in the three other places a tab can stand for indentation:

- Inside a block scalar — `foo: |` over a lone `\t` is reported, where the same
  line written ` \t` is valid content and still parses to `"\t\n"`.
- In the separation between a block indicator and a **compact collection** opened
  on its line. A compact collection takes its indentation from the column it lands
  on, so `-\t-`, `?\tkey:` and `:\t- x` are invalid — while `-\tfoo` and `-\t-1`
  are ordinary separation and stay valid.
- In a flow collection's continuation lines (below).

**A flow collection is held to the indentation of the block that holds it.** Flow
scanning is delimiter-driven, so `flow: [a,` over a column-0 `b,` read exactly
like a properly indented collection and parsed clean; it is now reported once per
collection as `BAD_INDENT`. Indentation is counted in spaces, which folds the tab
rule in for free. The closing `]`/`}` is deliberately held one column looser than
the spec asks — to the parent's own column rather than one past it — because
closing a multi-line flow collection at the parent's column is how Prettier and
hand-written manifests both write it, and `yaml` and `js-yaml` both accept it.

**A tag or anchor inside a flow collection ends at the flow indicator.** In
`{ foo : !!str, }` the tag token swallowed the comma, which the tag-character check
then reported while the missing comma left the mapping looking unterminated and
shifted every entry after it. Outside a flow collection those characters are still
ordinary tag content, so a block-context `!!str,` is still a `BAD_TAG`.

**Tab-indented JSON parsed to the wrong value.** A wrapped flow line's leading
whitespace is `s-indent(n) s-separate-in-line?`, so tabs sit in it as spaces do —
but the flow scalar scanner skipped only spaces, so the `]` closing a tab-indented
line was never seen as the flow indicator it is and the line folded into the scalar
instead. `JSON.stringify(value, null, '\t')` — what `jq --tab` and every
"indent with tabs" editor setting emit — therefore turned the last entry before a
`]` into a string with a trailing newline: `-1` came back as `"-1\n"`.

**The 1024-character implicit key limit is enforced in block context.** YAML caps
how far past a key's start its `:` may sit so a processor can recognize a mapping
entry with bounded lookahead; a longer block key is now `BAD_IMPLICIT_KEY`. It is
deliberately *not* enforced in flow context, matching `yaml` (eemeli): a flow
mapping is where JSON lives, `{"…1100 characters…": 1}` is valid JSON, and
rejecting a valid JSON document is the worse of the two errors. Relatedly, an
explicit key in a flow sequence may now put its `:` on the next line
(`[ ? a\n : b ]`) — the one-line rule exists to keep an *implicit* key cheap to
recognize, and a `?` settles that up front.

**The JSON-superset property is now checked, not assumed.** `@amritk/lint` routes
`.json` documents through the YAML parser and `resolveRefsFromFile` hands it
whatever a `$ref` points at, so "JSON parses as YAML" is load-bearing.
`src/json-superset.test.ts` runs a generated corpus against `JSON.parse` — every
value in six spellings (compact, 2-space, tab-indented, CRLF, and with
leading/trailing blank lines), requiring an identical value *and* zero diagnostics
for each — and `@amritk/lint` gains a matching test holding `parseJson` and
`parseYaml` to identical data, diagnostics, and `line:column` ranges for every path
in a JSON document.
