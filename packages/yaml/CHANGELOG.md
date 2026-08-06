# @amritk/yaml

## 0.7.0

### Minor Changes

- eb4e216: Remove a quadratic scan on colon-free documents, resolve paths through aliases
  and duplicated keys, and read numeric tags the same whether or not the value was
  quoted.

  Four fixes from a pre-release audit — a fuzz over serializer output, a
  mutation fuzz (~260k documents, no crash or hang), and a run of structural
  invariants over the official test suite plus the vendored real-world specs.

  **A large colon-free document cost O(n²).** Finding the `: ` a plain scalar may
  not contain was handed to `indexOf`, which cannot be told where to stop and so
  searched to the end of the _document_ rather than to the end of the scalar. Any
  document with a long colon-free tail — a list of hostnames, package names, an
  allow-list — paid the full remaining length once per entry. A 1.4 MB list of
  80,000 plain scalars took 700 ms, and four times that at twice the size; it is
  now 28 ms and linear. The scan is bounded by the scalar's own text, which per
  character is the comparison `indexOf` was already doing, so throughput on real
  specs is unchanged. A 300,000-entry case pins it: a quadratic scan cannot finish
  inside the test's timeout.

  **`nodeAtPath` could not walk through an alias.** `required: *ref` pointing at a
  sequence is how specs share a list — OpenAI's public OpenAPI document does it
  twice — and `toJS()` expands it, so `['…', 'required', 0]` addresses a real
  value. Every path underneath an aliased collection returned `undefined` anyway,
  or, with `closest`, the wrong ancestor's span. Aliases are now followed on the
  way down, resolving to the node inside the anchored definition; a path that
  _ends_ on the alias still returns the alias node, so a diagnostic points at the
  `*ref` the document wrote rather than at the distant anchor.

  **`nodeAtPath` resolved a duplicated key to the shadowed pair.** `toJS()`
  assigns pairs in order, so the last one written is the value the caller holds —
  the rule `JSON.parse` follows and what `uniqueKeys: false` documents — while the
  lookup returned the first match, pointing a diagnostic at a value nobody is
  looking at. It now scans back to front.

  **`!!int` / `!!float` on a quoted number lost the tag's meaning.** The coercion
  went through `parseInt`, which stops at the `x` of `0x1F` unless told base 16,
  and `parseFloat`, which reads `.inf` as `NaN`. So `!!int "0x1F"` came back as
  `0` where the unquoted `!!int 0x1F` came back as `31`, and `!!float ".inf"`
  stayed a string. Quoting no longer changes what a tag means: the text goes
  through the core schema first, matching both `yaml` (eemeli) and `js-yaml`.

  Diagnostics now arrive in **source order**. A duplicate-key report is raised
  after its value has been parsed, so it used to land behind problems found inside
  that value even though the key comes first — a consumer showing "the first
  error" named the wrong one.

  Documentation catches up with two behaviors that were true but unstated: `parse()`
  and `toJS()` do throw on a resource-exhaustion document (runaway alias expansion
  or nesting too deep to project), which the `parse` JSDoc previously denied
  outright; and a path resolves to no node when the key was written with no value
  (`paths:` → `null`) or was brought in by a `<<` merge, both of which fall back to
  the holding map under `closest`.

## 0.6.0

### Minor Changes

- 05d0b29: Stop dropping sequence entries after a property-only entry, and parse flow
  collections written as explicit or non-first mapping keys.

  Two shapes lost data silently, both found by differential fuzzing against `yaml`
  (eemeli) and `js-yaml`.

  **A sequence entry holding only a tag or an anchor swallowed the entries after
  it.** `- !!str` with nothing following it on the line is an entry whose value is
  an empty (tagged) node, and the next `-` at the same column is its _sibling_.
  The properties-with-no-inline-value path adopted that dash as nested content
  instead, on the "a block sequence may sit at its mapping's own column" rule —
  which is true for a mapping value and not for a sequence entry. `- !!str\n- a\n- b`
  came back as the single item `[["a", "b"]]` rather than `["", "a", "b"]`, so
  every entry after the first was both misplaced and one level too deep. The
  allowance is now scoped to the mapping parents it was written for; content that
  really is indented past the dash still nests as before.

  **A flow collection whose text contains a `: ` was read as a block mapping.**
  The lookahead that decides whether a line is a `key: value` entry honored quotes
  but not flow collections, so it split at the collection's _own_ separator:
  `? {x: 1}` keyed the mapping by the plain scalar `{x` with the value `1}`, and
  the same happened on the value side of an explicit entry (`? k` / `: {x: 1}`)
  and on any block-mapping entry after the first (`a: 1` / `{x: 2}: v`). The value
  side produced wrong data with no diagnostic at all. The scan now steps over a
  leading flow collection before looking for the separator, and a flow collection
  used as a key is parsed as a node rather than sliced as text — so it keys the
  mapping by the same rendering an identical collection on a _first_ entry has
  always produced, and the nodes inside it keep their source positions.

  Duplicate-key tracking now covers collection keys too. It skipped them on the
  grounds that they had no stable text form, which stopped being true once
  `keyText` learned to render them in flow style: `toJS` keys the projected object
  by exactly that string, so two collection keys that render alike really do
  collide and one value was overwritten with nothing reported. `{ [a, b]: 1, [a, b]: 2 }`
  and a collection key duplicated through an alias to it are now reported like any
  other duplicate. This is the breaking part of the change — documents with such a
  key that previously parsed clean now carry a `DUPLICATE_KEY` error, and
  `{ uniqueKeys: false }` accepts them as before. For the same reason `--- [a, b]: v`
  now reports the block mapping it opens on the `---` line, which the old flow-blind
  lookahead waved through; a bare `--- {a: 1}` is still fine.

- a6bd637: Add opt-in comment retention, and tell a recursive alias from a missing anchor.

  **`keepComments`.** Comments were skipped and unrecoverable — there was no way to
  read one, which is what stops a linter from honoring an inline
  `# …-disable-next-line` suppression or writing a rule about documentation
  comments. `parseDocument(src, { keepComments: true })` now fills
  `doc.comments` with every comment in source order, each carrying its exact
  `[start, end)` span and its text.

  The value is that **only the parser knows which `#` are comments**: inside a
  quoted scalar, a block scalar, or a plain scalar a `#` is content, so
  `a: "not # a comment"` and `a: foo#bar` hold none, and no scan of the raw text
  tells the difference reliably. Comments on `---`/`...` marker lines and directive
  lines are included, and each document of a stream gets its own list.

  It is a flat list rather than a `comment` field per node, deliberately: which node
  a comment belongs to is a policy call (the line above a key usually introduces it,
  the one trailing the previous line usually does not), and a parser that guesses
  imposes its guess on every consumer. The spans pair against any node's
  `start`/`end`, so callers keep that decision.

  Off by default, so parsing to data does not pay for it. The cost when off is one
  boolean test per line plus four fields on the parser's state object: CI's
  benchmark gate measures between -1.0% and -4.5% across the six yaml cases, all
  inside its ±5% noise band but consistently negative, so read it as a low
  single-digit cost rather than as free.

  Checked against `yaml`'s CST tokenizer across the vendored OpenAPI fixtures and
  ~9k fuzzed documents that both parsers accept, with no divergence.

  **`RECURSIVE_ALIAS`.** An alias inside the node its own anchor names —
  `&a [1, *a]` — was reported as `UNRESOLVED_ALIAS`, whose message says the anchor
  does not exist. It does; the node is simply still being built. Recursive
  structures stay unsupported (a cyclic value is not the plain tree `toJS`
  promises), but the diagnostic now says which of the two problems it is. A
  genuinely missing anchor still reports `UNRESOLVED_ALIAS`.

### Patch Changes

- 7d2c805: Report a second anchor or tag written on one line, instead of dropping the first.

  The property scanner reads whatever properties precede a node, and a repeat
  simply overwrote what came before: `a: &x &y 1` lost `&x` and `a: !!str !!int 1`
  lost `!!str`, both silently. `yaml` and `js-yaml` reject the shape outright. The
  multi-line spelling — `&x` on its own line above a `&y` value — was already
  caught; this is the same rule applied when both sit on one line, and it reports
  once, not twice.

  Found by auditing the README against the parser: the `BAD_PROPERTY` row already
  claimed this was reported, and it was the one documented diagnostic that could
  not be produced.

## 0.5.0

### Minor Changes

- 7839a38: Read the block shapes that were folding structure into strings

  Nineteen more YAML test suite cases — 365/402 to **384/402 (95.5%)**. Every one
  of them was a document whose structure the parser flattened into text or
  orphaned entirely, and none of them produced a diagnostic saying so.

  **Node properties written on a mapping key now apply to the key.** `&a a: b`
  anchors the scalar `a`, so `*a` is the string `"a"`; before, the anchor stayed
  inside the key's text and every alias to it reported `UNRESOLVED_ALIAS` and
  projected to nothing. The same for tags — `!!str 23: v` keyed the mapping by the
  literal `"!!str 23"` rather than by `"23"`. Anchor names that hold a `:` work
  too (`&a: key: value` anchors `key` as `a:`), which needs the properties scanned
  before the key separator is looked for, not after. Properties on a line of their
  own above the mapping still describe the mapping. Reaching this costs one
  character comparison per mapping entry — the scan itself only runs for a key
  that is actually annotated.

  **A `: ` inside a plain scalar is reported** (`BAD_SCALAR_CONTENT`). The spec
  ends a plain scalar there, so `a: b: c: d` is an error and not the string
  `"b: c: d"`; so is a continuation line that reads as a mapping entry, which is
  what a mis-indented `k1: v1` / `⟨space⟩k2: v2` is. The scan is an `indexOf`, so
  a scalar with no colon in it — nearly all of them — pays one native pass that
  finds nothing. Quoted, block, and flow scalars are unaffected.

  **Block collections may open on an explicit entry's introducer line.** `? a` /
  `: - one` is a sequence whose first entry shares the `:` line, and
  `? earth: blue` a mapping whose first entry shares the `?` line; both folded
  into the value as text. Their remaining entries align under that first one, not
  under the introducer. The mirror-image shape after an _implicit_ key
  (`key: - a`) is invalid YAML and is now reported rather than folded. Relatedly,
  a `? ` introducer is settled by the first two characters, so it outranks any
  `: ` further along the line — testing the colon first read `? earth: blue` as a
  key called `? earth`.

  **Indentation is measured against the parent, not against the node.** The
  parser treated "the parent's column" as one less than the column the node
  started at, which is only true when a node begins exactly one column in. When it
  did not, documents were cut short: a plain scalar stopped at the first
  continuation line that stepped back (`a:` / `⟨2 spaces⟩foo` / `⟨1 space⟩bar`
  dropped `bar`, and a sequence entry that wrapped was split into two entries), a
  zero-indented sequence introduced by a tag or an anchor was orphaned and
  reported as stray content (`sequence: !!seq` over a `- entry` list, `seq:` /
  `⟨1 space⟩&anchor` over one), and a block scalar counted its indentation
  indicator from the wrong column. The document root still measures against -1, so
  `--- |2` is unchanged.

  The `parseAllDocuments` / `parseDocument` API, `toJS()` projection, and every
  node's `[start, end)` span are unchanged, and the parser's throughput is
  unchanged on all three benchmark fixtures.

- 007aa05: Support lone-`\r` line breaks, stop `<<` dropping inherited-name keys, and make
  `nodeAtPath` agree with `toJS()`

  Five silent-data-loss bugs, each in a path the differential corpus and the
  yaml-test-suite do not reach.

  **A lone `\r` truncated the document, with no diagnostic at all.** The scanner
  skipped to the next line by looking only for `\n`, so a CR-delimited document had
  every line after the first jumped over — `a: 1\rb: 2\rc: 3\r` parsed to
  `{ a: 1 }` and reported zero errors, and a single stray CR inside an otherwise-LF
  file made one key vanish. YAML 1.2 §5.4 makes all three of `CR LF`, `CR`, and
  `LF` a line break, and now so do we — in the parser and in `lineCounter`, so
  positions stay exact. `CR LF` still counts once. The differential suite re-runs
  every case in all three break styles.

  **`<<` dropped any merged key that shares a name with an `Object.prototype`
  member.** The "does the target already have this key?" test walked the prototype
  chain, so `toString`, `valueOf`, `constructor`, `hasOwnProperty`,
  `isPrototypeOf`, `__proto__` and friends were silently discarded from the merge.
  Only own keys shadow a merged one now; `__proto__` is still defined as plain data
  rather than assigned through the prototype setter, so the pollution guard holds.

  **`nodeAtPath` could not find the keys `toJS()` produces.** It carried its own
  simplified key-stringifier that returned `'null'` for a null key, `'*ref'` for an
  alias key, and `''` for every collection key — so `null: v`, `*a : v`, and
  `[a, b]: v` were unreachable by path, and a `closest: true` lookup quietly
  returned the _parent's_ source span: a diagnostic pointing at the wrong line. It
  now uses the parser's own projection, which is exported as `keyText` for anyone
  building paths by hand.

  **An unterminated quoted scalar lost its last character.** The recovery sliced
  off a closing quote that was never there, so `a: "abcd` recovered as `"abc"` —
  the wrong text for a linter to echo back. The `UNTERMINATED_QUOTE` error was
  always correct; the text now is too.

  **`parseDocument` truncated a `---` stream without saying so.** Reading only the
  first document is intended, but a caller on `parse()` sees only the data. It now
  pushes a `MULTIPLE_DOCUMENTS` warning pointing at the marker and naming
  `parseAllDocuments`. A trailing marker with nothing under it stays quiet.

  Also: `lineCounter` builds its index with `indexOf` instead of a per-character
  loop — 2.6–3.6× faster, taking it from ~18% of parse+index cost to ~6%. And the
  bundle-size benchmark now bundles a consumer of each parser rather than the
  barrel, which tree-shook to a 156-byte stub and made the README's size table
  fiction; the corrected numbers are in the README.

- 1b720e2: Parse the node written on a `---` line, and stop flow scalars losing their type

  Four silent-data-loss bugs, each in a branch that was already cold.

  **A node written on the `---` line was discarded.** The document head skipped
  the whole marker line, so `--- |` lost its block-scalar indicator and re-read
  the body as a folded plain scalar (line breaks gone), `--- foo` lost the scalar
  entirely, and a tag or anchor on the marker line never applied. The node is now
  parsed and measured against column 0 rather than the column the marker pushed it
  to, so `--- >` may hold content starting at column 0. A block _mapping_ on the
  marker line is invalid YAML and is now reported. This is also what makes
  `--- !!set` / `--- !!omap` reach their `Set` / `Map` projections.

  **A flow scalar that ended its line lost its core-schema type.** `{ a: 1, b: 2 }`
  resolved `b` to the number `2`, but the same document wrapped —
  `{ a: 1,\n  b: 2 }` — resolved it to the _string_ `"2"`, because the multi-line
  path folded the segments without resolving them. Every entry of a flow
  collection written across lines was affected. Such a scalar also now ends at a
  `:` or `#` that opens the next line, instead of folding it in — `{foo\n: bar}`
  used to key the mapping by `"foo\n"`.

  **Double-quoted folding ran before escapes were resolved,** so it could not tell
  an escaped `\t` (content) from a literal trailing tab (padding), and it turned a
  `\` line-continuation's break into a space the `\` then absorbed. Escapes are now
  resolved per line first, and folding strips only whitespace the document wrote
  literally.

  **A block-folded scalar treated only a space as "more indented",** so a break
  beside a tab-led line folded to a space and the blank line next to it was lost.

  Also: an unterminated quoted scalar now stops at a `---`/`...` marker instead of
  swallowing every document after it; `!!str` over a wrapped plain scalar reads the
  folded text rather than un-folding it; and the stream-level directive rules are
  enforced — a directive needs a `...` before it and a `---` after it, its version
  must parse, a second `%YAML` is an error rather than a warning, and a tag may not
  hold a flow indicator. New code: `UNEXPECTED_DIRECTIVE`.

  Conformance against the official YAML test suite is **336/402 (83.6%)**, up from
  293/402, with every remaining gap still listed and reasoned.

- c1a176f: Report the syntax errors that were quietly changing what a document said

  Twenty-nine more YAML test suite cases, every one of them in a branch that was
  already cold — a block scalar header, a backslash, a `#`, a node property.

  **A block scalar header was accepted whatever followed it.** `folded: > first
line` dropped `first line` and re-read the body below as the scalar; `|10` took
  the `1` as an indentation indicator and threw the `0` away; `>#comment` read a
  comment the spec does not allow there; and a repeated indicator (`|--`) silently
  kept the last one. The header now ends where its indicators do, and anything
  past it is a `BAD_BLOCK_HEADER`. A leading blank line indented deeper than the
  block's first content line — which makes the block's own indentation ambiguous —
  is a `BAD_INDENT`.

  **A `\` escape the spec does not define passed through as the bare letter,** so
  `"a\.b"` became `a.b` and `"it\'s"` became `it's`, each silently dropping a
  character the document wrote. Undefined escapes are now `BAD_ESCAPE`; the value
  is still produced, so nothing that parsed stops parsing.

  **A `#` with no whitespace before it is not a comment.** `key: "value"# text`,
  `[ a, b ]#text`, and `[ a, b,#text` each dropped the rest of the line as though
  it were one (`BAD_COMMENT`). The mirror image is fixed too: a comment _does_ end
  a plain scalar, so `word1 # comment` followed by `word2` no longer folds `word2`
  into the value — it is reported as content no node claims.

  **An implicit key has to fit on one line.** A quoted key spanning lines
  (`"a\nb": 1`), a flow collection used as a block key across lines (`[23\n]: 42`),
  and a compact `[ key\n : value ]` sequence entry are now `BAD_IMPLICIT_KEY`. A
  flow _mapping_ may still write `{ "foo"\n: bar }` — the spec allows that one.

  **Node properties are checked where they land.** An anchor or tag written on an
  alias (`key: &b *a`) was dropped without a word, and two anchors reaching one
  scalar kept only the second: both are now `BAD_PROPERTY`. A block sequence
  opened on a properties line (`&anchor - entry`) read as the plain scalar
  `"- entry"` and is now reported.

  **Also:** a multi-line quoted scalar whose continuation lines do not clear their
  parent's indentation is a `BAD_INDENT`; a `-` where a flow entry belongs (`[-]`)
  is a `BAD_SCALAR_START`; and a `---`/`...` marker inside a flow collection, or
  in the middle of a wrapped flow scalar, ends the document instead of being
  absorbed into it.

  New codes: `BAD_BLOCK_HEADER`, `BAD_COMMENT`, `BAD_ESCAPE`, `BAD_IMPLICIT_KEY`,
  `BAD_INDENT`, `BAD_PROPERTY`.

  Conformance against the official YAML test suite is **365/402 (90.8%)**, up from
  336/402, with every remaining gap still listed and reasoned. Measured against
  main with the ABBA bench harness over three full runs, every fixture is within
  noise: the one cell that ever flagged — `large (data)`, at -8.9% — came from the
  run sharing the machine with a test suite, and read -1.5% and +3.2% in the two
  runs that had it to themselves.

- 00eb0c9: Read tabs by the column they sit at, hold a flow collection to its parent's
  indentation, and pin JSON as the superset it is

  YAML 1.2 test suite conformance goes from **384/402 (95.5%) to 398/402 (99.0%)**.
  What is left is four cases where the right answer is not the suite's — one
  duplicate-key case that turns on the `uniqueKeys` default, and three tags that
  project to a `Uint8Array`/`Set`/`Map` — so this closes the boundary rather than
  moving it. Parse throughput is unchanged: an order-balanced A/B over the bench
  fixtures lands every case inside run-to-run noise (medians −3% to +1.6% against a
  4–6% CV, with min-of-runs favouring the new code).

  **A tab is only an error where indentation belongs.** Indentation in YAML is
  spaces (`s-indent ::= s-space × n`), but a tab _past_ the indentation is ordinary
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
  deliberately _not_ enforced in flow context, matching `yaml` (eemeli): a flow
  mapping is where JSON lives, `{"…1100 characters…": 1}` is valid JSON, and
  rejecting a valid JSON document is the worse of the two errors. Relatedly, an
  explicit key in a flow sequence may now put its `:` on the next line
  (`[ ? a\n : b ]`) — the one-line rule exists to keep an _implicit_ key cheap to
  recognize, and a `?` settles that up front.

  **The JSON-superset property is now checked, not assumed.** `@amritk/lint` routes
  `.json` documents through the YAML parser and `resolveRefsFromFile` hands it
  whatever a `$ref` points at, so "JSON parses as YAML" is load-bearing.
  `src/json-superset.test.ts` runs a generated corpus against `JSON.parse` — every
  value in six spellings (compact, 2-space, tab-indented, CRLF, and with
  leading/trailing blank lines), requiring an identical value _and_ zero diagnostics
  for each — and `@amritk/lint` gains a matching test holding `parseJson` and
  `parseYaml` to identical data, diagnostics, and `line:column` ranges for every path
  in a JSON document.

### Patch Changes

- 2c9982c: Fix the published manifests so the packages install, resolve, and dedupe correctly

  **Types resolve on TypeScript's default config.** Every package was
  exports-only: nine declared `"module": "./dist/index.js"` (a field neither Node
  nor TypeScript reads) and nothing declared `types`. A consumer on
  `moduleResolution: "node10"` — still the default when `module` is `commonjs` —
  cannot see `exports` at all, so `import { lintDocument } from '@amritk/lint'`
  failed with `TS2307: Cannot find module '@amritk/lint' or its corresponding type
declarations`. Each package with a `.` export now also declares `main` and
  `types`; `@amritk/helpers` and `@amritk/adapters` have no `.` export (they are
  subpath-only), so they declare a `typesVersions` wildcard mapping instead, which
  gives their subpaths the same node10 fallback. All of it is ignored under
  `node16`/`nodenext`/`bundler`, where `exports` still wins.

  **`workspace:*` resolves to a caret, not an exact pin.** All fourteen
  inter-package edges shipped as exact versions, so installing two `@amritk/*`
  packages published at different times pulled in two copies of their shared
  dependency. That is not merely wasteful: the module-level caches those packages
  rely on are per-copy, so the `WeakMap` validator cache in
  `@amritk/runtime-validators` silently stopped hitting. Pre-1.0 a caret stays
  narrow (`^0.9.1` is `>=0.9.1 <0.10.0`) and breaking changes here already ride a
  minor bump.

  **`@amritk/helpers` stops shipping 21 source files it does not need.** Embedded
  mode reads four helper sources (`is-object`, `validate-array`,
  `validate-record`, `has-ref`) out of the installed package at generation time,
  so `src` has to ship — but only those four. `files` now lists them explicitly
  instead of globbing all of `src`, cutting the tarball from 78 files / 206 kB to
  63 / 112 kB.

  **Two packages no longer declare a dependency they never import.**
  `@amritk/mjst` and `@amritk/generate-parsers` both listed
  `@amritk/generate-markdown` under `dependencies`, but the only importer is each
  package's `scripts/generate-readme.ts`, which is not published. Both moved to
  `devDependencies`. `@amritk/adapters` likewise dropped its
  `@sinclair/typebox` peer dependency: the TypeBox adapter is purely structural
  (it strips symbol keys) and imports nothing. `valibot` stays — it is a genuine
  transitive peer of `@valibot/to-json-schema`.

  **`@amritk/mjst` fixes.** `json-schema-typed` moved to `dependencies`, because
  the shipped `dist/emit-examples.d.ts` imports types from it. The package gained
  an `exports` map, so it is no longer deep-importable in its entirety. And the
  build now marks `dist/cli.js` executable: `npm pack` records on-disk modes, and
  package managers only `chmod` bin targets when they link them, so flows that
  consume the tarball directly (vendoring, Docker `npm pack` + `tar -x`) hit
  `EACCES`.

## 0.4.0

### Minor Changes

- e6f0ff2: Close the YAML 1.2 gaps that cost nothing on the hot path, and measure the rest
  against the official test suite.

  **Fixed — silent data loss**

  - A collection used as an implicit mapping key (`[a, b]: value`, `{a: 1}: value`)
    discarded the mapping and every sibling entry, returning only the collection.
  - An alias used as a mapping key (`*ref: value`) was keyed by the literal text
    `*ref` instead of the anchored value.
  - An anchor on an empty node (`a: &anchor`) was never registered, so a later
    `*anchor` — which is legal, and resolves to null — dangled.
  - Node properties written on their own line no longer swallow the node below
    them when it sits at the same indentation.
  - A block scalar opened on a `- ` line measured its content against the item's
    column rather than the sequence's, dropping the scalar's body.

  **Added — tag resolution**

  `!<verbatim>` tags, `%TAG` handle declarations, and the non-specific `!` now
  resolve. A local tag keeps its `!` on `node.tag` (`!custom`), so an application
  tag sharing a core tag's name no longer coerces its value like the core one.

  **Added — diagnostics**

  `UNRESOLVED_ALIAS`, `UNEXPECTED_CONTENT` (trailing content after a node, and a
  second root node with no `---`), `UNEXPECTED_COMMA` (empty flow entries),
  `BAD_SCALAR_START` (reserved `@` / `` ` ``), `BAD_TAG`, and `UNKNOWN_TAG_HANDLE`.
  Directive problems (`%YAML` version, duplicates, unknown directives) are reported
  as warnings, which populates `doc.warnings` for the first time.

  **Added — conformance harness**

  `src/conformance.test.ts` runs the official YAML test suite: **293/402 cases
  (72.9%)**, up from 251/402. Every remaining failure is listed with its reason, and
  the test fails if a case moves in either direction, so the README's scope section
  is now checked rather than asserted.

  **Behavior changes** (pre-alpha; `@amritk/lint`'s path index is updated to match)

  - `node.tag` for a local tag is now `!custom` rather than `custom`.
  - An empty mapping key projects to `''` rather than `'null'`.
  - A collection mapping key projects to its flow rendering (`'[ a, b ]'`) rather
    than `''`.

  Parser throughput is unchanged. Measured in-process against the previous parser
  across six document shapes — a tiny config, a 2 KB OpenAPI document, a 100 KB
  document, a 400-key plain block mapping, a quoted-scalar mapping, and a 200-entry
  block sequence — every shape lands within ±1% of the old parser, and the 100 KB
  document is faster. Every check added here sits in a branch that was already
  cold, reuses a character read the parser was already making, or was moved out of
  a hot function so it does not affect what the JIT inlines.

## 0.3.5

### Patch Changes

- 65771d4: Repair the workspace type check and complete the published manifests

  `bun run types:check` had been failing for three packages and nothing in CI ran
  it. `@amritk/lint`, `@amritk/runtime-validators`, and `@amritk/yaml` were the
  only tsconfigs without the `**/*.test.ts` exclude the other nine carry, so their
  test files pulled the shared OpenAPI fixture loader into the program, where its
  `@amritk/resolve-refs` / `@amritk/yaml` imports do not resolve from the repo
  root. CI now runs `types:check` alongside the lint and test steps.

  Every package declares `engines: { node: '>=20' }`, matching the Node target the
  CLI already emits for, so an install on an older runtime warns instead of
  failing at run time. Every library also declares `sideEffects: false` so bundlers
  can tree-shake them — relevant to `@amritk/runtime-validators`, `@amritk/lint`,
  and `@amritk/yaml`, which are built to ship into browsers and Workers. The CLI
  is excluded: its bin runs on import.

  `@amritk/runtime-validators` no longer depends on `json-schema-typed`. It never
  imported the package, and the dependency was installed by every consumer of the
  one package whose design goal is staying self-contained.

- 491bde2: Stop allocating a `Set` per mapping to track duplicate keys

  Duplicate-key detection cost 11–25% of parse time, and the cost scaled with the
  number of mappings rather than document size. Both mapping parsers allocated a
  `Set` as soon as a map had a second key, and real documents are overwhelmingly
  made of tiny maps — `openai.yaml` (2.8 MB) has 13717 mappings averaging 2.7 keys
  each, so parsing it allocated 9214 `Set`s, 99.3% of them to deduplicate eight
  keys or fewer.

  A `Set` is the right structure asymptotically and the wrong one at three keys.
  Below a threshold the parser now scans the pairs it has already collected, which
  allocates nothing; past it, it builds the `Set` once and hashes from there.
  Throughput improves 4–7% on real-world OpenAPI specs and ~27% on documents dense
  with small flow mappings such as `{ type: string, format: date }`.

  Behavior is unchanged: reported errors are byte-identical, complex (map/seq)
  keys are still skipped rather than collapsed into one bucket, and `uniqueKeys`
  still turns the check off. The tracking logic had been duplicated verbatim
  between the block and flow mapping parsers and is now a single shared helper.

## 0.3.4

### Patch Changes

- 1901231: Ship AI-agent-facing docs. Each package now includes an `AI.md` in its published
  tarball — a mental model, a minimal runnable example, and the gotchas most
  likely to trip up an LLM — and gains `@example` JSDoc on its primary exports. A
  root `llms.txt` / `llms-full.txt` (generated by `bun run generate-llms`) indexes
  them, and `@amritk/mini` adds a `check:reactivity` guard for the compilerless-JSX
  "called signal" footgun.
- 019ecbc: Cap recursion depth when projecting a parsed document to JS (`toJS()` /
  `parse()`), closing a stack-overflow DoS. The parser already bounds structural
  nesting, but aliases are re-expanded during projection: an alias defined at
  shallow depth can point at a deeply-nested node, and a chain of such aliases
  made the expanded traversal far deeper than the parse tree while keeping the
  node count under the existing alias-expansion budget. A small untrusted document
  (tens of KB) could therefore drive projection into the native stack ceiling and
  throw an uncatchable `RangeError`. Projection now enforces its own depth limit
  (twice the parse cap, so ordinary alias reuse of a deep shared subtree still
  works) and throws the same catchable resource-exhaustion error the budget does.

## 0.3.3

### Patch Changes

- 6e7c65e: Slim published packages — comments are now stripped from the compiled JS in `dist` (they were duplicating the JSDoc that already ships in the `.d.ts` files, which is what editors read), and `@amritk/lint` now minifies its bundled OpenAPI meta-schema JSON documents. Unpacked size drops ~30% across the board (for example `@amritk/lint` 448 kB → 307 kB, `@amritk/generate-parsers` 293 kB → 191 kB) with no behavior change: declaration files keep their docs, `/* @__PURE__ */` annotations and the CLI shebang survive, and `@amritk/helpers` still ships its TypeScript sources for embedded mode.

## 0.3.2

### Patch Changes

- 4e23c02: Packaging fixes across all published packages: the `types` export condition now precedes runtime conditions (`default`/`import`) so TypeScript resolves the declared `.d.ts` explicitly instead of relying on file adjacency, and published tarballs now include the LICENSE file (copied in during the publish job).

## 0.3.1

### Patch Changes

- 6eac298: Fix a plain scalar losing its type when a blank line follows it. A blank line before the next entry staged a continuation segment, forcing the multi-line code path, which returned the folded text verbatim instead of resolving it through the core schema — so `port: 8080\n\nhost: x` parsed `port` as the string `"8080"` (and `true`/`1.5`/`null` likewise became strings). The folded value is now resolved just like the single-line path; a genuinely multi-line plain scalar still folds to a string.

## 0.3.0

### Minor Changes

- a834a17: feat(yaml): fold plain scalars that wrap across lines inside flow collections. A plain scalar spanning multiple lines within `[ … ]` / `{ … }` is now folded per YAML 1.2 flow line folding — a single line break becomes a space, a run of _n_ breaks yields _n − 1_ newlines, and each wrapped line's leading indentation is trimmed — matching `yaml` (eemeli). Previously such a scalar was truncated at the first line break and its value could be silently wrong.

## 0.2.3

### Patch Changes

- c288a90: Security and robustness hardening:

  - **resolve-refs**: the SSRF guard now rejects non-`http(s)` redirect targets, so a
    remote schema can no longer bounce a fetch to `file://`/`data:` and disclose
    local files; remote fetches also gain a timeout and a response-size cap.
  - **generate-parsers / generate-validators / helpers**: schema-controlled strings
    (property names, enum values, patterns, required keys) are now escaped via
    `JSON.stringify` before being emitted into generated TypeScript. Previously a
    crafted enum value or property name could break out of — or inject code into —
    the generated output.
  - **runtime-validators**: recursive `$ref` schemas (e.g. `{ $ref: '#' }`) no longer
    overflow the stack; property presence is checked with `Object.hasOwn`, fixing a
    false-accept of an inherited `constructor` and a false-reject of a real
    `__proto__` property.
  - **yaml**: alias expansion is bounded (billion-laughs protection) and parser
    nesting is depth-limited, so a tiny adversarial document can no longer hang the
    process or overflow the stack.
  - **helpers / yaml / resolve-refs**: `__proto__` keys in untrusted input are stored
    as own data instead of mutating an object's prototype.

## 0.2.2

### Patch Changes

- 4aa1c6e: Fix two parser divergences from `yaml` (eemeli) surfaced by differential testing:

  - An explicit `!!bool` tag on a quoted or block scalar now coerces to a boolean
    (`!!bool "true"` → `true`), matching how `!!int` / `!!str` / `!!null` already
    read tagged scalars.
  - A bare `-` at the end of a line is now recognized as a sequence entry with an
    empty (null) value everywhere a sequence can start, not just mid-list. Trailing
    empty items are preserved (`- a\n-\n` → `['a', null]`) and a block sequence made
    entirely of bare dashes parses as a list (`a:\n  -\n  -\n` → `{ a: [null, null] }`)
    instead of collapsing into a plain scalar.

## 0.2.1

### Patch Changes

- b0c83e7: Fix several correctness issues surfaced by a code review:

  - **yaml**: negative hexadecimal and octal scalars (`-0x10`, `-0o10`) no longer
    have their sign double-applied and flipped positive; out-of-range or malformed
    `\x`/`\u`/`\U` escapes in double-quoted scalars are now treated as literal text
    instead of throwing a `RangeError` (via `String.fromCodePoint`) or silently
    dropping the following characters.
  - **resolve-refs**: `pointerToPath` only coerces canonical RFC 6901 array-index
    tokens to numbers, so a numeric object key with a leading zero such as `"01"`
    is kept as a string rather than aliased to a different key. The shared
    JSON Pointer segment decode is now factored into one helper.
  - **generate-validators**: object/array `const` checks compare with a new
    order-independent `valuesEqual` runtime helper instead of `JSON.stringify`, so
    a reordered-but-equal value matches (in step with the interpreter);
    `propertyNames` now validates every key against the full subschema (length,
    enum, const, `$ref`), not just the `pattern` form; and the draft-04 boolean
    `exclusiveMinimum`/`exclusiveMaximum` form is honored.
  - **helpers**: add `hasStrictExclusiveMinimum` / `hasStrictExclusiveMaximum`
    guards for the draft-04 boolean exclusive-bound form.

## 0.2.0

### Minor Changes

- ca07514: Resolve the common extended `!!` tags, matching `yaml` (eemeli): `!!binary` →
  `Uint8Array`, `!!timestamp` → `Date`, `!!set` → `Set`, and `!!omap` → `Map`.
  These coerce only on an explicit tag, so an untagged ISO date string still
  resolves to a string. Flow sequences now accept implicit single-pair-map
  entries (`[ key: value ]`), the shape `!!omap` is written in.

  Tabs used for indentation are now reported as a `TAB_INDENT` error with an exact
  source span, instead of being silently mis-parsed. Tab indentation remains
  unsupported (it is forbidden by YAML 1.2); detection costs one comparison per
  line, so the per-character scanning hot path is unchanged.

- f129364: Add three parser features that fit the existing single-pass design without a
  hot-path cost:

  - **Core-schema `!!` tags** — `!!str`, `!!int`, `!!float`, `!!bool`, and `!!null`
    now coerce scalar values during `toJS()` (so `!!str 123` is the string
    `"123"`). The coercion lives in the lazy projection and is gated on a scalar
    actually carrying a tag, so the tree-building path is untouched. Unknown/custom
    tags still pass through with their value unchanged and the tag left on the node.
  - **Multi-document streams** — new `parseAllDocuments(source, options?)` returns
    one document per `---`-separated body, each with its own anchors and problem
    lists. `parseDocument` still reads only the first document. The single-document
    path is unchanged; the stream loop only engages once a real boundary appears.
  - **Explicit `? key` / `: value` mapping entries** — including block and flow
    keys, mixed with implicit entries. Detection is a single gated branch per
    mapping entry, so ordinary `key: value` maps pay nothing measurable.

  Tab (non-space) indentation remains out of scope: it would add a comparison to
  the innermost scanning loop and is forbidden by YAML 1.2.

### Patch Changes

- 6b5f25f: Fix `>` folded block-scalar folding to follow YAML 1.2 line-folding rules.
  Previously every line break in a folded scalar was collapsed to a space, which
  mangled real-world documents (e.g. embedded code samples in the OpenAI OpenAPI
  spec). Now:

  - **More-indented lines** keep their line breaks — a break adjacent to a line
    indented past the block's base indent stays literal instead of folding to a
    space, and that line's extra indentation is preserved.
  - **Blank lines** fold correctly: a run of `p` blank lines between two normal
    lines yields `p` newlines, but `p + 1` when either neighbour is more-indented
    (the entering break is only trimmed when it would otherwise fold to a space).
  - **Leading and trailing whitespace lines** are handled per spec — leading
    blank lines survive as line breaks, and a trailing whitespace-only line that
    reaches past the block indent is preserved as content rather than chomped.

  Validated against the `yaml` reference parser over the new vendored OpenAPI
  corpus and an end-to-end fuzz of randomized folded scalars.

## 0.1.1

### Patch Changes

- 8395066: Fix multi-line flow-scalar folding, clarify the README, and broaden the
  differential tests.

  - Fix two bugs in single-/double-quoted multi-line scalar folding that produced
    the wrong string for documents like the GitHub OpenAPI spec: trailing
    whitespace on a scalar's final line was incorrectly stripped (it is literal
    content, since no line break follows), and a blank-line run reaching the
    closing quote emitted one newline too many. Output now matches `yaml` (eemeli)
    byte-for-byte on the full GitHub and DigitalOcean specs.
  - Replace the `[start, end)` interval notation in the README, which reads as a
    mismatched bracket pair, with plain wording that spells out the `start`
    (inclusive) and `end` (exclusive) offsets, and fix the `nodeAtPath` API row to
    say nodes carry `start`/`end` rather than a `range`.
  - Add the real-world DigitalOcean OpenAPI spec as a vendored fixture and
    regression cases for the folding fix. The fixture lives outside `src/`, so it
    is not shipped in the published package.

## 0.1.0

### Minor Changes

- 185c63b: Squeeze more throughput out of the parser hot path and shrink the node tree.

  Hot-path tuning (no API change): a precomputed first-character lookup table for
  plain-scalar resolution, eliminate a redundant `key:` colon scan when entering a
  block mapping, hoist quoted-key handling out of the colon scanner's per-character
  loop, and build `toJS` collections with index loops instead of a per-sequence
  `.map` closure.

  Smaller nodes (**breaking shape change**): each node and error now carries inline
  `start` / `end` number fields instead of a `range: [start, end]` (and error
  `pos`) tuple. This removes a second heap allocation per node — on a 100 KB OpenAPI
  document that is ~12k fewer arrays — cutting retained tree memory by ~35–45% and
  making the source-mapped parse ~9–19% faster (largest gains on small/medium docs).

  Migration: replace `node.range[0]` → `node.start`, `node.range[1]` → `node.end`,
  and `error.pos[0]` → `error.start`. The `Range` type export is removed. Node
  guards (`isMap`/`isScalar`/…) and `nodeAtPath` are unchanged.

- 84e3cda: Add `@amritk/yaml`: a tiny, dependency-free YAML parser with exact source
  positions, built for diagnostics. Every node records its `[start, end)` source
  range so a consumer can map any value back to an exact `line:column`. It parses
  to data via `parse`, to a positioned tree via `parseDocument`, resolves a JSON
  path to its node with `nodeAtPath`, and maps offsets to `line:column` with
  `lineCounter`. Covers block and flow collections, all quoting styles, block
  scalars with chomping, comments, anchors, aliases, and merge keys, with YAML 1.2
  core-schema scalar resolution. Benchmarked ~20× faster than `yaml` for building
  a source-mapped tree and ~7.6× smaller, with a differential test suite pinning
  data output to `yaml` across full OpenAPI specs.
