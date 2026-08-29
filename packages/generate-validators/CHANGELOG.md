# @amritk/generate-validators

## 0.14.0

### Minor Changes

- 18b817a: Judge a combinator branch against a value that is there, and count `contains` by
  index.

  Both are verdict changes for values JSON cannot hold — an array hole, or an
  explicit `undefined` — and both move the generated validator onto the answer
  `@amritk/runtime-validators` and Ajv already give.

  A combinator's branches were evaluated in optional mode even where the caller had
  already established the value is present, so every leaf check inside them read
  `x !== undefined && …` and a hole satisfied all of them: `prefixItems: [{ allOf:
[{ type: 'string' }] }]` accepted `[<hole>]` that `prefixItems: [{ type: 'string' }]`
  rejected. `contains` counted matches with `filter`, which skips holes outright, so
  a sparse array came up an element short — and against `contains: { not: { type:
'string' } }` the hole is the matching item.

  The `contains` loop stops at `minContains` when there is no `maxContains` to
  count for, and emits nothing at all for a `minContains: 0` that no array can fail.
  A schema-form `additionalProperties` now tests declared keys through the shared
  `unknownKeyCheck` instead of rebuilding an array literal for every key of every
  object it validates.

- 62c81b8: Stop reading schema text as code, and fix `uniqueItems` on values JSON cannot hold.

  The emitters used to write `errors.push(` and let a `replaceAll` over the finished
  function text rewrite it into the create-on-first-use form (and an unread
  `(input: unknown` parameter into `(_input: unknown`). Both substrings are ordinary
  schema content, so a schema that spelled one had it rewritten inside its own data:
  `pattern: "errors.push(x)"` compiled to `/(errors ??= []).push(x)/`, a regex that
  matches nothing, and an `enum` member or property name spelling it was compared
  against a string nobody wrote. `isX` was built without the rewrite, so the two
  disagreed on the same input. The error sink is now carried through the emitters,
  so the final spelling is written the first time and no generated text is ever
  rewritten. Output is byte-identical for every schema that does not spell one of
  those substrings.

  `uniqueItems` over provably-scalar items now dedupes with a bare `Set` instead of
  a `JSON.stringify` projection: SameValueZero is JSON Schema's equality for
  primitives exactly, where stringifying printed both `NaN` and `null` as `"null"`
  and called `[NaN, null]` a duplicate pair.

  The emitted `validation-result.ts` changes with it. `valuesEqual` now counts `NaN`
  equal to itself, matching Ajv and `@amritk/runtime-validators`, and caps its walk
  at 512 levels so a self-referential value returns a verdict instead of throwing a
  `RangeError` out of a function whose signature promises a `ValidationResult`.
  `allUnique` buckets by a structural hash before comparing, the same way the
  interpreter does — an array of 4 000 distinct objects took 570ms of pairwise
  comparison and now takes 7ms.

- 78b7972: Judge a dynamic key's value, and an array hole, as the value it is.

  A `patternProperties` / `additionalProperties` / `unevaluatedProperties` value was
  checked in optional mode, so every check wore a leading `value !== undefined &&`
  and a property whose value _is_ `undefined` satisfied all of them at once:
  `{ a: undefined }` passed an `additionalProperties: { type: 'string' }`. The key
  came out of a sweep over the object, so it is present by construction and its
  value is there to be judged — which is what Ajv and `@amritk/runtime-validators`
  both do. `unevaluatedItems` swept with `every`, which skips holes outright, so an
  index nothing evaluated went unchecked and `[<hole>]` passed an
  `unevaluatedItems: { type: 'string' }`; it materialises the array first now, the
  same way the boolean guard already did.

  Neither value can come out of `JSON.parse`, so this changes no verdict for a
  document parsed from JSON.

### Patch Changes

- 0f27eeb: Re-measure every published benchmark table on Bun 1.4.

  The tables were labelled Bun 1.3 and predate both the runtime upgrade and this
  release's interpreter work, so every one of them was re-run rather than
  relabelled. All measurements come from one Linux x64 box with nothing else on
  it, each package's own `bun run bench`, and the machine is named in each table's
  caption — compare columns within a table, not against a figure you remember.

  Three of them changed in ways a version label would have hidden:

  - **`@amritk/lint`** — Spectral's JSONPath engine used to throw on the 2.8 MB
    OpenAI spec under Bun, so that row was published as mjst-only. It no longer
    throws, and the row is a real comparison now (~0.73 s against ~7.4 s). The
    bench keeps its guard, since that failure was runtime-specific.
  - **`@amritk/api`** — Bun 1.4 made web-standard `Request`/`Response`
    construction far cheaper, which lifted every column of the Bun table (bare
    Hono went ~185k → ~503k ops/s). The compiled engine still leads the
    like-for-like `hono + zod` column on Bun and Node, but it no longer leads
    _unvalidated_ Hono on the GET cases, and under workerd it now trails
    `hono + zod` on the static GET. The prose says so.
  - **`@amritk/runtime-validators`** — the interpreter is much faster than when
    the ratios against Ajv were written, so the cold-path win narrows to ~96–870×
    (from ~90–1600×) and the steady-state loss narrows to ~6–11× (from ~15–25×).

  `@amritk/generate-parsers`, `@amritk/generate-validators`, `@amritk/resolve-refs`
  and `@amritk/yaml` keep the same shape and conclusions with refreshed numbers.

- ec764d0: Emit no symbol the generated file never reads, so the output compiles clean under
  `noUnusedLocals` / `noUnusedParameters` — the flags this repo holds itself to and
  any consumer inheriting them.

  A `$ref`'s import carries the type, the validator, or both, decided from the text
  that was emitted: a ref in a position the type generator does not read (an `if`
  arm, whose whole node it types `unknown`) is called and never named, and one in a
  position only the type reads (a tuple's rest taken from `additionalItems`) is
  named and never called. A `contains` whose match is decidable (`contains: true` /
  `contains: false`) needs no loop at all, so it no longer binds an element nothing
  looks at, and the `_item0` / `_root` bindings are emitted only where a check reads
  them.

  The compile suite now runs every case under those flags rather than holding a
  list of known gaps.

- fc60a77: Refuse a type name TypeScript will not take. The root type name is used verbatim
  and the type suffix is appended to every name derived from a `$ref`, so
  `buildValidatorSchema(schema, 'my-doc')` emitted `export type my-doc = …` — output
  that does not parse, discovered in the consumer's build with nothing to say about
  where it came from. Generation now stops with the name and the reason.
- 77f2f78: Refuse a definition named after the runtime contract, and keep a control
  character in a property name out of the emitted source.

  A `$defs` entry whose type name comes out as `ValidationError` (written that way,
  or as `validation-error`, or `validation_error`) emitted a file importing that
  name twice — once from `validation-result.ts`, which every generated file imports,
  and once from its own module. That is a `TS2300` for anyone building the output
  and a duplicate binding Node ESM never loads past. Generation now refuses, the way
  it already refuses a definition that wants the `validation-result.ts` filename; a
  `typeSuffix` that moves the name clear still generates.

  Error-path segments are escaped the way JSON escapes a string, so a property name
  holding a control character survives into the emitted template literal. A raw
  carriage return did not: a template normalises `<CR>` to `<LF>`, so the error for
  a `"foo\rbar"` property pointed at `"foo\nbar"` — a different property, and one
  the same document is free to declare beside it.

- bbda384: Sweep an object's keys once. `patternProperties` opened a `for…in` per pattern and
  a schema-form `additionalProperties` opened another, so three patterns beside an
  `additionalProperties` schema walked the object four times over for a body that is
  a handful of `if`s. They share one loop now — same checks, same verdicts, one
  pass.
- 543fbe8: Read every schema keyword as the node's own property.

  The generators asked `'items' in schema` and read `schema.type` straight off the
  node, and both walk the prototype chain. With `Object.prototype.items` set — by a
  dependency with a prototype-pollution bug, or simply by a schema built over a base
  object — every node in the document answered "yes" to keywords none of them
  declared, and the result was a _different validator_: an inherited `items: false`
  made every array have to be empty, an inherited `patternProperties` swallowed the
  `additionalProperties` sweep so unknown keys stopped being reported, and an
  inherited `if`/`then`, `allOf` or `contains` sent a walker into unbounded
  recursion, so `buildValidatorSchema` threw a `RangeError` instead of generating.

  `@amritk/helpers/own-keyword` is the shared reader — the question
  `@amritk/helpers/schema-guards` and `@amritk/runtime-validators` already ask, for
  the keywords with no named guard. Generated output is unchanged for every schema
  in the conformance corpus and the vendored OpenAPI fixtures.

- 4102fdf: Docs: correct two invariants that had gone stale, and write down what the
  generator refuses.

  `AGENTS.md` and `AI.md` both said `NaN` satisfies numeric bounds and differs from
  Ajv. It has not for some time: every bound is emitted as the negated pass
  condition, so `NaN` fails a _constrained_ number and satisfies a bare
  `{ "type": "number" }` — which is Ajv's answer too, and the interpreter's, pinned
  value-by-value in `interpreter-parity.test.ts`. `AGENTS.md` also still said
  `unevaluatedProperties` / `unevaluatedItems` throw, where they have been generated
  (with four named refusing shapes) for a while.

  The README gains the names generation will not emit, and a note on the values
  JSON cannot hold — an `undefined` at a swept key, a hole in a sparse array, `NaN`
  under `const` / `enum` / `uniqueItems`, and a self-referential object — each of
  which now answers the way the interpreter and Ajv answer.

- 95f3cd8: Add a differential fuzz over the whole generated set: random schemas carrying a
  `$ref` into `$defs`, combinators, tuples, `contains` and hostile property names
  are built, linked and run, and every verdict is held against both the runtime
  interpreter and Ajv, with `isX` held against `validateX`. The existing fuzz
  covers one emitted function against Ajv; this covers what only appears once the
  output is several files that have to import and call each other.
- Updated dependencies [1c328af]
- Updated dependencies [1fd154c]
- Updated dependencies [3557eb5]
- Updated dependencies [11a280f]
- Updated dependencies [e091f22]
- Updated dependencies [3a54baf]
- Updated dependencies [543fbe8]
- Updated dependencies [c6a1f16]
- Updated dependencies [261f650]
  - @amritk/helpers@0.16.0

## 0.13.1

### Patch Changes

- Updated dependencies [34c5eaf]
  - @amritk/helpers@0.15.4

## 0.13.0

### Minor Changes

- 823ea4e: Fix twelve bugs found by an audit of the validator generator. The first three
  are one bug wearing three hats, and it is the headline: a generated validator
  could accept documents the schema forbids.

  ### Wrong verdicts

  - **A `const` or `enum` silently dropped every sibling keyword.** The emitter was
    a chain of `if (keyword) { emit; return }`, so the first keyword it recognised
    swallowed the rest: `{"type": "string", "const": 1}` compiled to an equality
    check and nothing else, and the generated validator accepted `1`. It reproduced
    under `properties`, `items`, `prefixItems`, `contains`, `additionalProperties`,
    `patternProperties`, `propertyNames`, `dependentSchemas`, `not`,
    `if`/`then`/`else` and `allOf`, and at the document root. The keyword emitters
    now compose instead of dispatching, with the presence check for a `required`
    property hoisted so it is still reported once.
  - **A top-level `$ref` dropped its siblings too.** `{"$ref": "#/$defs/s",
"minLength": 3}` compiled to a bare delegation and accepted `"q"` —
    contradicting 2020-12, and contradicting the generator's own handling of the
    same shape under `properties`.
  - **`$ref` siblings were dropped everywhere except `properties`,** where
    `type` / `const` / `enum` siblings were dropped instead. Wrong in both
    directions: `{"not": {"$ref": "#/$defs/s", "minLength": 3}}` made the inner
    schema broader than written, so it wrongly _rejected_ `"a"`.
  - **A draft-07 tuple (`"items": [...]`) produced no array validation at all**
    while the type generator emitted a real tuple type, so the emitted type and the
    emitted validator disagreed about the same schema. Array-form `items` and its
    `additionalItems` tail are now read as the tuple they are — with `prefixItems`
    taking precedence when a node carries both, matching the type generator and the
    runtime interpreter. Each dialect's closing keyword now applies only within its
    own dialect: `additionalItems: false` next to a 2020-12 `prefixItems` capped a
    length that Ajv, the interpreter, and the tuple type emitted beside it all
    leave open.
  - **Error paths built from a runtime key were not JSON-Pointer escaped.** A
    `patternProperties` match, an `additionalProperties` sweep or a `propertyNames`
    loop reported `{"a/b": …}` at `/a/b`, which reads back as the child `b` of a
    property `a`. Keys the schema names statically were always escaped, and
    `@amritk/runtime-validators` escapes the same way; the runtime ones now do too,
    via an `escapePointer` helper in the emitted `validation-result.ts`.

  ### Unsound `isX` guards

  The flat boolean guard must never accept what `validateX` rejects. Three ways it
  did:

  - A `required` key with no `properties` entry contributed no condition at all, so
    `isX({})` answered `true` for `{"type": "object", "required": ["a"]}`.
  - `items: false` was ignored (`hasItems` is false for a boolean `items`), so
    `isX([1])` answered `true` for an array schema admitting no elements.
  - A draft-07 tuple was read as a tail schema and produced no per-item test.

  An `enum` carrying a constraining sibling is now composed with it rather than
  answered by membership alone — which was the unsound reading — while keeping the
  inline guard for `{"type": "string", "enum": [...]}`, the commonest shape in an
  OpenAPI document.

  ### Generated output that does not compile

  Compiling every generated file set in the two vendored corpora (1,361 schemas,
  under the flags `generated-code-types.test.ts` already declares) found 61
  TypeScript diagnostics. Both corpora now compile clean.

  - A combinator branch the compiler can decide statically was still emitted as a
    live condition, leaving provably unreachable code (58× `TS7027`): an `anyOf`
    with a `true`/`{}` branch, and a boolean `if` or `not`. These fold now, with no
    change of verdict.
  - A `type: "object"` root read its combinator branches against the narrowed
    `Record<string, unknown>`, so a branch from another family compared an object
    against a string (`TS2367`, plus a cascade on `never`). The same applied to a
    `dependentSchemas` / `dependencies` subschema, which is applied to the object
    itself.
  - A guard member and an `unevaluated*` key both read through a cast, which no
    `typeof` in front can narrow, so a constrained check emitted `.length` on
    `unknown` (`TS2571`).
  - The `unevaluated*` coverage sweep reads its leftover value _inside_ a `.every`
    callback, and TypeScript keeps a narrowing across that boundary only for a
    plain binding — never for a property read. One instance location down,
    `Array.isArray(obj.a)` in front of the sweep said nothing inside it, so a
    constrained `unevaluatedProperties` at any array position emitted `TS18046` /
    `TS2571`. The object is bound to a local before the callback now.
  - An `enum` member of a different JSON type than the sibling `type` sat behind
    the `typeof` that narrows the accessor, so it compared two disjoint types
    (`TS2367`). Such a member can never match, and is dropped.
  - Folding a branch away can strand what building it left behind: the compiled
    pattern table it hoisted, and — when it was the only reader — the `input`
    parameter itself (`TS6133` under `noUnusedLocals` / `noUnusedParameters`). A
    validator now carries only the hoisted declarations its body reads, and an
    unread parameter takes the `_` prefix the generator uses everywhere else.
  - An `if` the emitter can decide picks one arm, and the arm it drops is read by
    nobody: unlike an `anyOf` branch, which the type generator still unions,
    neither arm of an `if` is read by the type at all. Its `$ref` is no longer
    collected, where before it was a wholly unused import (`TS6192`) — and, since
    `assertGeneratableRefs` reads the same set, a refusal to generate at all when
    that arm's `$ref` happened to be unresolvable. The spellings that fold are the
    emitter's own: `{}` and an annotation-only schema, not just a literal boolean.
  - Whether a hoisted declaration is still read is decided by a fragment the
    emitter wrote, not by searching the emitted text for the name. That text is not
    all code — a property name reaches it as data and a `pattern` as a regex
    literal — so the name alone answered the wrong question in both directions.

  ### Generation that fails late instead of loudly

  - **A `$defs` entry named `index` or `validation-result` was skipped silently.**
    Its importers were still generated, so the output carried an
    `import { validateIndex } from './index.js'` that nothing satisfies — a
    `TS2305` when built and a `SyntaxError` when run. Generation now refuses and
    names the definition, the same answer two definitions competing for one
    filename already get. A root type name that collides is refused too, instead of
    producing no root validator.
  - A `$ref` in a position neither emitter reads (`additionalItems` with no array
    `items`; `then`/`else` with no `if`) was collected as though it were, so
    generation refused a perfectly good schema when that ref happened to be
    unresolvable. Conversely, a `$ref` in a position only the _type_ generator
    reads — a tuple's rest, when `prefixItems` took the positions out from under an
    array `items` — was not collected, and the emitted type named something no
    import brought in (`TS2304`, on `main` too).
  - **A definition named `…-or-reference` was imported from the wrong file.** The
    import collector rewrote the ref to its base name first, so a schema with a
    `#/$defs/parameter-or-reference` got `import { validateParameter } from
'./parameter.js'` while the body called `validateParameterOrReference` — a
    runtime `is not defined`, and with no base `parameter` definition, an import of
    a module that was never written. `walkRefGraph` gives such a definition a file
    of its own; it is now imported from it, under the name the emitter uses. The
    OpenAPI 3.1 metaschema names definitions exactly this way, and
    `@amritk/generate-parsers` dropped the same rewrite for the same reason.
  - **An `unevaluated*` under a draft-07 `additionalItems` was refused** on the
    grounds that the position is never enforced. That was true while
    `additionalItems` was read only as a length cap; now that the tail is
    validated, the draft-07 spelling of a schema whose 2020-12 spelling generates
    is accepted, and the refusal is kept for the positions that really are inert.

  Three JSON Schema Test Suite cases move from expected-failure to passing as a
  result (two `$id`-scope cases and one `$dynamicRef` case, all of which needed a
  root `$ref`'s siblings to be enforced), leaving 7 documented gaps.

### Patch Changes

- 36f03a2: Review follow-ups to the sibling-composition fix: three symbols the generated
  output declared without reading, and a tuple type no validator would have held
  anyone to.

  ### Unused symbols in the emitted files

  All three are `noUnusedLocals` / `noUnusedParameters` errors in a consumer's
  build — flags this repo holds itself to and any consumer inherits — and all three
  were found by compiling the vendored OpenAPI corpus under them rather than
  reasoned about. Each is an ordinary shape, not a corner:

  - **`ValidationError` was imported by every generated file.** Only a body that
    _accumulates_ errors names the type; a validator whose whole answer is one
    inline `return { valid: false, errors: [ … ] }` never declares the array. That
    is every scalar root — `{ "type": "string" }`, the commonest schema an OpenAPI
    document has — plus a delegating `$ref`, a `const`, an `enum` and a boolean
    root. The import is now conditional, the same way the runtime helpers beside it
    already were.
  - **`const obj = input as Record<string, unknown>` was emitted by both flat
    guards regardless.** A node with no property to read guards on the shape alone
    and never touches the narrowing, so `{ "type": "object", "properties": {} }` —
    in `openai.yaml` today — declared it twice and read it neither time. The cold
    error-collecting body already had this liveness test; the exported validator's
    hot guard and `isX` now share it.

  ### A tuple type nothing enforced

  `getTuplePositions` took the positions from a _non-empty_ `prefixItems` and
  otherwise fell back to the draft-07 array `items`, so an empty `prefixItems`
  fell through to the array behind it: `{ "prefixItems": [], "items": [{"type":
"string"}] }` typed as `[string?, ...unknown[]]` while
  `@amritk/runtime-validators` and the generated validator both read the
  `prefixItems`, found no positions, and enforced nothing. A `prefixItems` that is
  merely present now takes the positions there too, which is what both runtimes
  already do, so the type says `unknown[]` — a widening rather than a claim. An
  empty _array_ `items` is unaffected: with no `prefixItems` to displace it, it is
  a draft-07 tuple of no positions whose every index answers to `additionalItems`,
  and the emitter validates it as such.

  ### Docs the audit invalidated

  The audit moved three JSON Schema Test Suite cases to passing, but the numbers
  quoted in prose did not move with them: the README still advertised **1271 /
  1281 (99.2%)** and enumerated ten failures including two `$id`-scoping cases that
  now pass. It is 1274 / 1281 (99.5%) and seven. `conformance.test.ts` now pins
  both totals, so the next gap that closes fails the build instead of leaving the
  package advertising a worse number than it delivers.

  The README and `AI.md` also still listed "a node under `additionalItems`" among
  the shapes where an `unevaluated*` refuses. That refusal is now limited to an
  _inert_ `additionalItems` — one with no array `items` to be the tail of, or with
  a `prefixItems` that took the positions out from under it.

- Updated dependencies [36f03a2]
  - @amritk/helpers@0.15.3

## 0.12.2

### Patch Changes

- Updated dependencies [2e3399a]
  - @amritk/helpers@0.15.2

## 0.12.1

### Patch Changes

- 4178e8d: Patch release across all packages.
- Updated dependencies [4178e8d]
  - @amritk/helpers@0.15.1

## 0.12.0

### Minor Changes

- de0952c: Make both generators agree with Draft 2020-12 — and with each other — on
  structural equality, tuple `items`, `oneOf`, and prototype-member property names.

  The two generators disagreed with Ajv and with one another on the same schemas.
  Where they differed, `generate-validators` was usually right: it already shipped
  `valuesEqual` / `allUnique`, which `generate-parsers` never adopted.

  **`@amritk/generate-validators`**

  - A property named `__proto__` was silently dropped. The `nullable` rewrite runs
    over _every_ schema and copied `properties` with a plain assignment, which fires
    the `Object.prototype` setter instead of creating a key — so
    `{"properties":{"__proto__":{"type":"string","minLength":3}}}` emitted a
    validator with no checks at all, and `required: ["__proto__"]` degraded to a
    bare presence check. A validation bypass.
  - `constructor` / `toString` / `hasOwnProperty` properties were read straight off
    the object, so the _prototype's_ value answered: a valid document was reported
    as `must be string` at `/hasOwnProperty`, and a required `toString` could never
    be reported missing (`'toString' in obj` is always true). Reads now go through
    an own-property guard, and presence uses `Object.hasOwn` — but only for the
    names that can actually be inherited. Every other key keeps the plain `in` it
    always had, because `Object.hasOwn` is a call the engine cannot fold the way it
    folds `in`, and spending it on `id` or `name` bought nothing while costing
    roughly half the throughput on an all-present object.
  - `items` alongside `prefixItems` was applied to the prefix positions too. Per
    2020-12 `items` is the tail schema, so `{prefixItems:[{type:'string'}],
items:{type:'number'}}` rejected `["a", 1, 2]` — which Ajv accepts, and which
    the `[string?, ...number[]]` type this generator emits already admits.
  - `enum` members that are objects or arrays could never match: `.includes` is
    SameValueZero, i.e. reference equality. `enum` now compares structurally via
    `valuesEqual`, the way `const` always has — which also makes `isX` a sound type
    guard again.

  **`@amritk/generate-parsers`**

  - The same `prefixItems` + `items` defect, in both the fast path and the strict
    assertion.
  - The same `enum`-with-object-members defect. Members are now compared by an
    unrolled structural check against the known literal.
  - `const` deep equality used `JSON.stringify`, which is key-order sensitive, so
    `{b: 2, a: 1}` was rejected against `const: {a: 1, b: 2}` — and it serialized the
    whole value on every call to do it.
  - `uniqueItems` used a `JSON.stringify` dedupe key (or a bare `Set`, which
    compares objects by reference), so `[{a:1,b:2},{b:2,a:1}]` was accepted where
    Ajv and `generate-validators` both reject. It now projects through a
    key-order-independent canonical form when items may be structural, keeping the
    cheap native `Set` when they are provably scalar. A root array of objects
    skipped the constraint entirely and now enforces it.
  - `oneOf` exclusivity was not enforced — both `oneOf` and `anyOf` compiled to a
    plain disjunction, so a value matching two branches was accepted. `oneOf` now
    requires exactly one match.
  - The array fallback was a bare `[]`, ignoring `prefixItems` and `minItems`. It is
    not an instance of its own schema, and against a required closed tuple it is not
    even assignable — `TS2322: Type '[]' is not assignable to type '[string,
number]'` made non-strict and `readonly` output fail to compile.
  - A schema property named after an `Object.prototype` member produced an
    unsatisfiable type: TypeScript reads the inherited `constructor: Function` on the
    fallback object literal and rejects it against `constructor?: string`.

  Both packages now type-check their generated output under the repo's real
  compiler flags (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), not
  `strict` alone — `generate-validators` had no such suite at all — and both pin the
  semantics above against Ajv (or, for prototype-member names, against
  `@amritk/runtime-validators`, since Ajv has those bugs itself).

- 213ecc4: Take documents you already loaded, so a `$ref` to another document generates

  **On the official JSON Schema Test Suite: `generate-validators` 1238 → 1268 /
  1281 (99.0%), `generate-parsers` 1222 → 1237 / 1281 (96.6%).**

  Both generators gain a `schemas` option: documents you have already loaded, keyed
  by the absolute URI a `$ref` names them by. It is the build-time counterpart of
  `@amritk/runtime-validators`' `ValidateOptions.schemas`, and it keeps the same
  promise — nothing is fetched, you cannot pass a URL, only a document. What changes
  is that "we do no I/O" no longer also means "we cannot be told".

  A cross-document `$ref` was the single largest gap in both packages, and it is
  gone. `refRemote.json` passes in full; so do the `dynamicRef.json` groups that
  reach `tree.json` and `extendible-dynamic-ref.json`, and — with the dialect
  metaschema registered — `defs.json` and `ref.json`'s "remote ref, containing refs
  itself".

  Each registered document becomes a resource of the document being generated: its
  `$id`, its `$anchor`s and `$dynamicAnchor`s and its own embedded resources all
  resolve, a `$ref` from one registered document into another resolves, and every
  definition reached gets a file, a type and a validator/parser by the ordinary
  rules. A document with no `$id` resolves its relative `$ref`s against the URI it
  was registered under; one whose `$id` disagrees answers to both. Registering more
  than the schema uses costs nothing — only the documents actually reached are
  emitted — and a `$ref` to a URI nobody registered still stops the build with a
  message naming the ref.

  The mechanism is one pass, not a second addressing mode. `@amritk/helpers` gains
  `graftExternalSchemas`, which embeds the registered documents into the root before
  the `$id` pass, and `pruneExternalSchemas`, which drops the unreferenced ones once
  the refs are pointers and reachability is finally knowable. Everything downstream —
  the ref-graph walk, the naming, the emitted import graph — keeps working on a
  single document and needed no change. `walkRefGraph` carries the option and
  memoizes per `(schema, schemas)` by identity.

  **Fixed: a root schema with a union `type` dropped every sibling constraint.**
  `{ type: ['object', 'boolean'], properties: {…}, required: [...] }` emitted the
  type check and nothing else, so it accepted any object at all. The multi-type root
  branch now emits the shared constraint checks the single-type and combinator
  branches already did; they carry their own runtime-type guards, so a member of the
  union a constraint does not apply to is still untouched. This is the shape the
  2020-12 metaschema's own root is written in, which is how it went unnoticed — the
  generated dialect validator accepted `{ type: 1 }` as a valid schema.

  `@amritk/runtime-validators` is unchanged in behaviour; its conformance figures are
  restated against the corpus that is actually vendored (1281 cases, not 1299 — the
  README's count never matched, and upstream's `content.json` is not among the
  vendored files). The suite's `remotes/` loader moves to the shared fixtures
  bookkeeping so all four conformance suites use one walk.

- eb80ca6: Fix `$ref`-graph naming and reference resolution, and stop degrading silently.

  Generation now fails loudly instead of writing output that cannot work:

  - Two definitions that reduce to one filename (`Pet`/`pet`) or one type name
    (`foo-bar`/`foo.bar`/`fooBar` all become `FooBar`) are an error. The filename
    case used to drop one definition and give every reference to it the other
    one's shape; the type-name case emitted both files and left the importer with
    two `import { FooBar }` lines that do not parse.
  - An unresolvable `$ref` is an error. It used to warn while the generators still
    emitted the type name and the parser/validator call for a file that was never
    written.
  - A `$dynamicRef` with no `$dynamicAnchor` to bind to is an error. Leaving it in
    place made the type generator name the type after the anchor, so the canonical
    recursive-tree idiom (`$dynamicAnchor: "node"`) produced a reference to the
    DOM's `Node` interface — a clean compile with the wrong type.
  - A document that relies on `$id` base-URI scoping is rejected rather than
    resolving its inner fragments against the document root and silently selecting
    a different definition.
  - Every recursive schema walker enforces a nesting cap and reports it by name
    instead of dying with a bare stack-overflow.

  And several things that were broken now work:

  - Non-ASCII definition names (CJK, Cyrillic, accented) keep their characters
    instead of collapsing onto the single type name `_`, and the generated
    `index.ts` barrel re-exports them correctly.
  - A root-level `$dynamicAnchor` is generated as the root's own file, so the
    2020-12 recursive-tree idiom produces a real self-referencing type.
  - A plain `$anchor` ref (`$ref: "#named"`) resolves, instead of producing the
    unloadable import specifier `'./#named.ts'`.
  - Derived filenames are normalized: no more `.ts`, `...ts`, `http:--x.ts`, or
    characters Windows and ESM specifiers reject. `$ref: "#/__proto__"` no longer
    resolves to `Object.prototype`.
  - Generated readers guard `Object.prototype` member names (`constructor`,
    `toString`, `__proto__`, …) with `Object.hasOwn`, so a schema with a
    `constructor` property no longer fails its own shape check for every valid
    object, and the parser no longer fabricates a `__proto__` key.
  - `x-mjst` `instanceOf` is allow-listed to the classes the generators support,
    so an arbitrary identifier is warned about and ignored instead of being
    emitted verbatim into the output.

- 947d44a: Enforce the keywords a schema declares without a `type`, and stop emitting
  validators that call functions nobody wrote

  Measured against the official JSON Schema Test Suite, generation goes from
  818/1299 to **987/1299 (76.0%)**.

  - **A schema with no root `type` compiled to `validateRoot = () => true`.** The
    generator hung every check off the declared type, so `{ "minLength": 2 }`,
    `{ "required": ["a"] }`, `{ "uniqueItems": true }`, `{ "contains": … }`,
    `{ "patternProperties": … }`, `{ "propertyNames": … }` and
    `{ "dependentRequired": … }` all accepted everything — the largest silent gap
    this generator had. Each keyword now emits its check behind its own runtime type
    test, so it rejects its own family and ignores every other kind of value, which
    is what JSON Schema means by a type-less constraint. The same gate was
    suppressing constraint checks next to a root combinator, so
    `{ allOf: [{ prefixItems: … }], items: … }` silently dropped its `items` too.
  - **Object keywords no longer imply `type: "object"`.** `{ "properties": … }`
    ignores a non-object instead of rejecting it, matching the interpreter. Note the
    inferred TypeScript type still describes the object case (as
    `FromSchema`/`ImplicitShape` in `@amritk/runtime-validators` does), so for that
    shape `isX` is a weaker type guard than it was — the verdict, which is the
    contract, matches the interpreter exactly.
  - **Boolean subschemas do something.** A root of `false` rejects every instance
    (it used to accept them all), and a `false` sitting in a `properties`, `allOf`,
    `then`/`else`, `patternProperties`, `dependentSchemas`, `prefixItems`,
    `contains` or `propertyNames` position now emits a real check.
  - **A `not` over a `type` array emitted nothing**, and "no checks" is how the
    matcher spells "matches everything" — so the `not` rejected every instance.
  - **Unresolvable `$ref`s produced output that does not compile.** For a ref the
    walker never queues (a relative path, an absolute path, a URN), the emitter
    derived a name from the ref string and called `validateIntJson(…)` without
    anything emitting it. Generation now refuses, naming the ref — the same answer
    the other unsupported paths already give, and a failure next to its cause rather
    than in the consumer's build.
  - **String lengths count code points, not UTF-16 units**, in both the validator
    and the guard, via the shared `@amritk/helpers/string-length-check` (`.length`
    stays the short-circuiting first term).

  `unevaluatedItems`/`unevaluatedProperties` still refuse at generation by design —
  flat output cannot carry annotations across the applicator tree — and `$id`
  base-URI resolution remains unimplemented, so those refuse rather than guess.

- 7757788: Generate `unevaluatedItems` / `unevaluatedProperties`, and stop `isX` claiming a
  narrowing it cannot make

  **On the official JSON Schema Test Suite: 987/1299 → 1238 / 1299 (95.3%).**

  The position that flat generated code cannot carry annotations across the
  applicator tree turned out to be wrong, and it was costing 201 cases — two thirds
  of everything this package failed. Both keywords are now emitted as a flat
  _expression_ computing what the interpreter computes as annotations: for each key
  or index, a boolean that is true when some keyword evaluated it. Keywords that
  must succeed for the value to be valid at all (`allOf` members, a `$ref` target, a
  satisfied `contains`) count unconditionally — sound, because the emitted test is
  one conjunct of a validator that also asserts them — while conditional applicators
  (`anyOf`/`oneOf` branches, `if`/`then`/`else`, `dependentSchemas`) carry their
  condition, hoisted to a `const` before the loop so a per-key sweep reads a boolean
  instead of re-running a match.

  `contains` publishes only the indices it matched, per the spec and
  `@amritk/runtime-validators`, rather than Ajv's whole-array mark.

  Four shapes still refuse, each with a message naming the shape rather than the
  keyword: coverage running through a `$dynamicRef`, an unresolvable or cyclic
  `$ref` at the same instance location, a walk deeper than eight applicators, and a
  node under `additionalItems`. No case in the suite hits any of them.

  Parity with the interpreter is the contract and is enforced as one:
  `interpreter-parity.test.ts` gains six hand-written groups plus a 500-schema ×
  24-value fuzz pass — 12,000 pairs, no divergence.

  **`isX` no longer lies.** For a schema with no `type`/`enum`/`const`/`$ref` but
  object-shaped keywords (recursively, so a union of implicit-object branches counts
  too), the emitted type describes the object case while the validator — correctly —
  also accepts non-objects. The guard now returns `boolean` for exactly those
  schemas instead of `input is X`; the check itself is unchanged and still in
  lockstep with `validateX`. Every schema that declares a `type` keeps its type
  predicate.

  The complete fix is to widen the emitted type so the narrowing becomes true, which
  lives in `@amritk/helpers/generate-type-definition` and has to move together with
  `FromSchema`'s `ImplicitShape` in `@amritk/runtime-validators`, since both make the
  identical inference for the identical schema. Until they do, a guard that declines
  to narrow beats one that narrows wrongly.

  Also inherited from `@amritk/helpers`: `$ref`s written against an enclosing `$id`
  now resolve, which closed most of this package's ref failures without a change
  here.

### Patch Changes

- 9cb45a0: Emit the interpreter's own `multipleOf` check, and compile `pattern` in Unicode
  mode — closing the last two places where generated code and
  `@amritk/runtime-validators` could disagree about a document.

  `@amritk/helpers/multiple-of-check` claimed to mirror the interpreter and had
  drifted from it. The interpreter splits on the divisor (an exact `%` when it is
  an integer, a quotient within `2·ε·|q|` when it is not); the emitter still
  divided in every case and allowed `1e-8·|q|` — roughly 10⁷× the actual
  representation error. Generated validators and parsers therefore **accepted
  values the interpreter rejects**: `1000000.005` against `multipleOf: 0.01` (a
  half-cent past a whole dollar amount) passed, and so did any value whose quotient
  overflows to `Infinity`, because the old fail expression asked `NaN > tolerance`
  and got `false`. The emitter now produces the interpreter's two branches
  verbatim, so both verdicts flip to invalid and the two implementations agree
  again. `0.3` still satisfies `multipleOf: 0.1`, which is what the tolerance is
  for.

  A `pattern` now compiles with the `u` flag wherever the pattern admits one, the
  same try-`u`-then-fall-back decision the interpreter makes at runtime, taken once
  at generation time by the new `regexLiteral` / `regexFlagsFor` in
  `@amritk/helpers/escape-regex-pattern`. Without the flag a Unicode property
  escape is inert — `\p{Letter}` was read as a literal `p{Letter}` — and `^.$`
  rejected a single astral character. Every emit site now goes through
  `regexLiteral` rather than interpolating an escaped body into its own `/…/`, so
  the flag decision is made in one place instead of at a dozen call sites.

  Measured against the official JSON Schema Test Suite, this closes three cases in
  each generator: `@amritk/generate-validators` moves to **1271 / 1281 (99.2%)**
  and strict `@amritk/generate-parsers` to **1240 / 1281 (96.8%)**.

- ef77708: Reject `NaN` against a numeric bound, matching `@amritk/runtime-validators`.

  Bounds were emitted as their direct failure condition (`x < minimum`) rather than
  the negated pass condition (`!(x >= minimum)`). The two agree on every ordinary
  value and are opposite for `NaN`, which compares `false` against every operator:
  the direct form read that as "not out of bounds" and let a `NaN` through
  `minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum`, where the
  interpreter and Ajv both reject it. Generated validators, strict generated
  parsers, and the compiled API engine's inlined guards all now write the negated
  form — so a `NaN` fails a bounded number everywhere in the toolchain. A bare
  `{ type: 'number' }` with no constraint still accepts it, as Ajv does; only a
  bound or `multipleOf` rejects it.

  Two internal inconsistencies close with it: `@amritk/generate-parsers` emitted the
  un-negated `x >= min` in its inline matchers and the direct `x < min` in its
  strict assertions, so the same schema could answer differently depending on which
  path ran, and `@amritk/api`'s compiled engine disagreed with its own runtime
  engine for a value the two are documented to be observationally identical on.

  `interpreter-parity.test.ts` now covers the numeric keywords — bounds, the
  draft-04 boolean `exclusive*` form, and `multipleOf` across integer, fractional,
  and quotient-overflowing divisors — over a value set built to separate the two
  spellings (`NaN`, `±Infinity`, `1e308`, `1000000.005`). Nothing pinned these
  before, which is how the drift got in.

- 798fd7a: Measure every schema-consuming package against the official JSON Schema Test
  Suite, the way `@amritk/yaml` is measured against the YAML test suite

  The required Draft 2020-12 tests (46 files, 383 groups, 1299 cases) are vendored
  under `fixtures/json-schema-test-suite`, and four packages now run them on every
  build. Each carries an expected-failure list naming every case it does not pass
  and why, and each suite fails when a case moves in **either** direction — a
  regression breaks the build, and so does a case that starts passing while its
  entry stays behind. Nothing is published: the corpus and the harnesses live
  outside every `files` list.

  | package                       | measured on                                      | rate                |
  | ----------------------------- | ------------------------------------------------ | ------------------- |
  | `@amritk/runtime-validators`  | `validate` and `validateGuard` verdicts          | 1250 / 1299 (96.2%) |
  | `@amritk/generate-parsers`    | strict parsers, generated → linked → executed    | 1180 / 1299 (90.8%) |
  | `@amritk/generate-validators` | generated predicate validators, likewise         | 987 / 1299 (76.0%)  |
  | `@amritk/resolve-refs`        | verdict preserved after inlining (`$ref` corpus) | 160 / 170 (94.1%)   |

  The generators are measured through the code they emit, not the source text they
  emit: each suite schema is generated whole, compiled, and linked in memory, so the
  `$ref`'d sibling files and the embedded runtime helpers run too. `resolve-refs`
  has no verdicts of its own, so it is held to semantic preservation — the resolved
  document must accept exactly what the original did, judged by
  `@amritk/runtime-validators` over the cases the interpreter already answers
  correctly, which is the population where a resolution bug is visible and nothing
  else is.

  Those rates are where the packages _end up_. The suites were written first and
  found real defects — a validator that accepted everything for a schema without a
  `type`, `required` satisfied by an inherited `toString`, refs that emitted
  uncompilable output, `$ref`-shaped data inlined as a reference — each fixed in its
  own commit alongside this one. What remains is documented case by case, and each
  package's README carries a "Conformance, measured" section with its number and the
  reasons behind it.

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

- Updated dependencies [213ecc4]
- Updated dependencies [9cb45a0]
- Updated dependencies [5afbfd4]
- Updated dependencies [eb80ca6]
- Updated dependencies [2c9982c]
- Updated dependencies [f439570]
- Updated dependencies [fa8620c]
  - @amritk/helpers@0.15.0

## 0.11.12

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

- dcc2ea4: Let `@amritk/api` assert string formats, and document where `format` is ignored

  `format` is an annotation in JSON Schema, and both Ajv and
  `@amritk/runtime-validators` make asserting it opt-in. `@amritk/api` never opted
  in and offered no way to, so a route declaring
  `{ type: 'string', format: 'uuid' }` accepted any string — while the README said
  the format "still applies". Short of replacing the whole engine through
  `compile`, there was no way to get the check.

  Both engines now take `formats`, matching the interpreter's own option:

  ```ts
  createApi({ routes, formats: "all" });
  createApi({ routes, formats: ["uuid", "email"] });
  compileToModule({ routes, routesImport, formats: "all" });
  ```

  A violation is an ordinary `400 { error: 'validation_failed' }`. Pass the same
  value to both engines so the compiled module and the development server agree;
  the option is ignored when a custom `compile` is supplied, since that replaces
  the engine it configures. Default behavior is unchanged — `format` stays an
  annotation until you ask.

  In the compiled engine a schema carrying `format` leaves the inlinable subset
  and falls back to the interpreter, which owns the format regexes, rather than
  the emitter growing a second copy of each. Engine-for-engine equivalence is
  covered by a new differential case.

  `@amritk/generate-validators` emits no `format` check either, and that was
  nowhere in its docs — a real divergence from the interpreter as `@amritk/lint`
  runs it (`formats: 'all'`). Now stated in the README, AI.md, and AGENTS.md, with
  a test pinning it, and the benchmark section no longer claims every library does
  the same work on the two rows whose schemas declare `format`.

- fe8191b: Close the gaps between the emitted TypeScript types and the schemas they come from

  The shared type generator read past several keywords, so the type it emitted
  described fewer documents than the schema allowed — and the parsers built from
  it disagreed with it. Generating the whole vendored OpenAPI corpus (982
  component schemas, 5,872 files) and compiling the result under `strict` went
  from 667 type errors to none.

  **Types**

  - `nullable: true` (OpenAPI 3.0) now widens the type with `| null` — 432
    occurrences in the vendored corpus were previously typed as non-null, which
    also made `generate-validators`' `input is T` predicate unsound, since its
    validator accepts null.
  - An array-form `type` keeps the shape it declares: `["object","null"]` with
    properties is `{ … } | null` instead of `Record<string, unknown> | null`, and
    `["array","null"]` keeps its item type. Members are deduplicated, and
    `readonly` applies to them.
  - `prefixItems` (and the draft-07 array form of `items`) emits a tuple instead
    of `unknown[]`, with positions optional past `minItems` and the tail typed
    from the sibling `items`/`additionalItems`.
  - Keywords declared _alongside_ `properties` are no longer dropped: `allOf`
    members written inline (not just `$ref`s) and sibling `oneOf`/`anyOf` unions
    are intersected in, `additionalProperties`/`patternProperties` become an index
    signature, and a nested schema with both `properties` and a union keeps both.
  - A `description` or `$comment` containing a comment terminator no longer ends
    the JSDoc block early — a glob like `**/*.ts` in a description used to make
    the whole generated file unparseable.
  - A URI `$ref` that resolves inside the document is named rather than typed
    `unknown`, matching the import the same file already emits for it.

  **Parsers**

  - An array-form `type` is enforced: strict parsers assert the disjunction (plus
    the constraints of the non-null member) instead of emitting no check at all,
    and the shape validator keeps a real fast path instead of degrading to a stub.
  - Inline `allOf` members are enforced in strict mode, and the fast path no
    longer jumps over those assertions.
  - A `required` key with no declared property is asserted present.
  - Tuple positions declared with the draft-07 array `items` are checked.
  - A `default` that contradicts its declared `type` is ignored rather than used
    as a coercion target.
  - Root-level tuple and item assertions are emitted once, not twice.
  - A file no longer imports from itself when a definition's name collides with
    the root type name, and colliding definition names are reported: two that
    reduce to one filename mean only the first is generated.

- Updated dependencies [65771d4]
- Updated dependencies [fe8191b]
  - @amritk/helpers@0.14.0

## 0.11.11

### Patch Changes

- Updated dependencies [217cb66]
  - @amritk/helpers@0.13.5

## 0.11.10

### Patch Changes

- 1901231: Ship AI-agent-facing docs. Each package now includes an `AI.md` in its published
  tarball — a mental model, a minimal runnable example, and the gotchas most
  likely to trip up an LLM — and gains `@example` JSDoc on its primary exports. A
  root `llms.txt` / `llms-full.txt` (generated by `bun run generate-llms`) indexes
  them, and `@amritk/mini` adds a `check:reactivity` guard for the compilerless-JSX
  "called signal" footgun.
- Updated dependencies [1901231]
  - @amritk/helpers@0.13.4

## 0.11.9

### Patch Changes

- 6e7c65e: Slim published packages — comments are now stripped from the compiled JS in `dist` (they were duplicating the JSDoc that already ships in the `.d.ts` files, which is what editors read), and `@amritk/lint` now minifies its bundled OpenAPI meta-schema JSON documents. Unpacked size drops ~30% across the board (for example `@amritk/lint` 448 kB → 307 kB, `@amritk/generate-parsers` 293 kB → 191 kB) with no behavior change: declaration files keep their docs, `/* @__PURE__ */` annotations and the CLI shebang survive, and `@amritk/helpers` still ships its TypeScript sources for embedded mode.
- Updated dependencies [6e7c65e]
  - @amritk/helpers@0.13.3

## 0.11.8

### Patch Changes

- 4e23c02: Packaging fixes across all published packages: the `types` export condition now precedes runtime conditions (`default`/`import`) so TypeScript resolves the declared `.d.ts` explicitly instead of relying on file adjacency, and published tarballs now include the LICENSE file (copied in during the publish job).
- Updated dependencies [4e23c02]
  - @amritk/helpers@0.13.2

## 0.11.7

### Patch Changes

- 2a89506: Apply 2020-12 sibling keywords alongside a property `$ref`. A property schema like `{ $ref: '#/$defs/str', minLength: 5 }` previously validated only the referenced schema and ignored the sibling constraint, so a too-short string passed. The generated validator now runs the referenced validator **and** the sibling constraint/combinator checks; a bare `{ $ref }` is unchanged. (Scoped to named properties; the dynamic-key value path — `patternProperties`/`propertyNames`/`additionalProperties` values — is unchanged for now.)
- 737b390: Fix several cases where a generated validator diverged from the runtime interpreter (its oracle), accepting invalid input or emitting broken code:

  - A `required` property whose schema is empty (`{}`) or boolean `true` now gets a presence check — previously the key could be missing and still validate.
  - A root scalar schema that combines a `type` with a combinator (e.g. `{ type: 'string', not: {…} }` or `{ type: 'number', minimum: 10, allOf: [{ maximum: 100 }] }`) now enforces the `type` and its sibling constraints instead of only the combinator branch.
  - `items: false` with no `prefixItems` now requires an empty array instead of being silently ignored.
  - A `$ref` reached only through a draft-07 schema-form `dependencies` entry is now imported, so the generated file no longer calls an undefined `validateX`.

- 797a156: Fix a batch of correctness bugs found in a cross-package audit:

  - **`@amritk/lint`**: the `alphabetical` rule compared decimal numeric strings lexically because of an inverted numeric guard, flagging correctly-ordered lists like `["9.5", "10"]` and missing genuinely out-of-order ones. Numeric strings now compare numerically on both sides.
  - **`@amritk/mjst`** (CLI): the `validators` key in a JSON config file was silently ignored, so `validators: true` in a config never emitted `validateX`/`isX` files. It is now read like every other boolean flag.
  - **`@amritk/runtime-validators`**:
    - `minContains: 0` together with `maxContains` no longer wrongly rejects arrays under `unevaluatedItems` (it now marks the array evaluated, matching Ajv).
    - the `ipv6` format now accepts IPv4-mapped / IPv4-embedded addresses (e.g. `::ffff:192.168.0.1`), rebuilt from the RFC 4291 grammar.
    - local `$ref` fragments are percent-decoded per RFC 6901 §6, so a ref like `#/$defs/a%20b` resolves to the key `a b` instead of throwing.
  - **`@amritk/helpers`**: `escapeRegexPattern('')` now emits `(?:)` instead of an empty body, so a schema `pattern: ""` no longer generates `//.test(...)` (a comment) that breaks the generated file. This also fixes the empty-pattern case in generated parsers and validators.
  - **`@amritk/generate-examples`**: integer arbitraries now round fractional bounds (`minimum: 2.5`, `exclusiveMinimum: 5.5`) to satisfiable integers instead of handing `fc.integer` a non-integral bound that throws at sample time; number arbitraries honour the tighter of an inclusive/exclusive bound pair instead of dropping the exclusive one.
  - **`@amritk/generate-validators`**: schema-controlled property names are now escaped when embedded in generated error-path template literals, so a key containing a backtick or `${…}` can no longer break compilation or inject an interpolation; paths also JSON-Pointer-escape `~` and `/` to match the interpreter.
  - **`@amritk/adapters`**: the Valibot adapter now targets Draft 2020-12, so tuples emit `prefixItems` (validated downstream) instead of draft-07 `items: [...]` (silently under-validated).

- Updated dependencies [797a156]
  - @amritk/helpers@0.13.1

## 0.11.6

### Patch Changes

- 1dbe5bc: Close verdict gaps where a generated validator was silently more permissive than
  `@amritk/runtime-validators` for the same schema. The generator now emits checks
  for keywords the interpreter already enforced but the generator skipped:

  - `minProperties` / `maxProperties` — the object's key count is now bounded.
  - draft-07 dual-form `dependencies` — the array form requires the listed keys and
    the schema form applies the subschema to the whole object when the trigger key
    is present (a `false` subschema makes the trigger's mere presence invalid).
  - OpenAPI 3.0 `nullable: true` — a `null` value is accepted regardless of the
    declared `type` (and short-circuits sibling keywords), folded into the `anyOf`
    form the generator already enforces so nested and property-level `nullable`
    work too.
  - Full `propertyNames` subschemas — every key is validated against the entire
    subschema (combinators, `type`, `multipleOf`, …), not just
    `pattern`/`minLength`/`maxLength`/`enum`/`const`/`$ref`.

  The allocation-free happy-path guard (and the `isX` boolean guard) bail to the
  error-collecting path for `minProperties`/`maxProperties`/`dependencies` — and,
  via the `nullable`→`anyOf` rewrite, for `nullable` — so their fast-path verdict
  can never disagree with the validator. Differential tests assert generator vs
  interpreter verdict parity across these keywords.

- 317a940: Fix `uniqueItems` in generated validators to match runtime `deepEqual`
  semantics. The generated dedupe check previously projected every item through
  `JSON.stringify`, which is key-order sensitive — so an array of two objects with
  the same entries in a different key order (`{ a: 1, b: 2 }` vs `{ b: 2, a: 1 }`)
  was wrongly accepted, while `@amritk/runtime-validators` (and Ajv) treated them
  as duplicates via order-independent structural equality.

  The generator now emits a structural `allUnique` helper from
  `validation-result.ts` and calls it whenever an array's items may be objects or
  arrays (or are unconstrained), keeping the cheap `JSON.stringify` projection only
  for provably scalar-only items. Both the error-collecting validator and the
  boolean type-guard take the same split, so their verdicts stay in lockstep.

- ce79384: fix: close correctness gaps in the validator generator.

  - **Array items are now validated in full**, matching the interpreter: an item's
    nested `properties`/`required`/`additionalProperties`, scalar constraints
    (`minLength`, `minimum`, …), and nested arrays are all enforced, recursing to
    any depth. Previously only the item's top-level type was checked, so e.g.
    `items: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }`
    accepted `[{ a: 123 }]` and `[{}]`. A sparse hole is correctly rejected. `isX`
    reaches the identical verdict. (Bare-type item arrays like `string[]` are
    unaffected; validating richer item contents costs throughput proportional to
    the per-item work.)
  - **Object-level combinators are no longer ignored by the flat guards.** For a
    schema pairing `properties` with `allOf`/`anyOf`/`oneOf`/`not`/`if`, the
    fast-path guard and `isX` previously short-circuited to `true`, accepting
    documents the combinator rejects. Such schemas now fall through to the
    enforcing validator.
  - **`dependentSchemas` is now implemented** (previously silently ignored): when a
    trigger property is present the whole object is validated against the
    associated subschema. `$ref`s reached only through `dependentSchemas` are now
    imported, and both flat guards bail on the keyword.
  - **Cleaner error paths.** Errors inside `if`/`then`/`else`, combinator branches,
    and dynamic-key values no longer contain `//` or a trailing `/`.

  Also documents that a `NaN` value satisfies a constrained-number schema (matching
  the interpreter).

- Updated dependencies [9bf3330]
- Updated dependencies [e612130]
  - @amritk/helpers@0.13.0

## 0.11.5

### Patch Changes

- Updated dependencies [1bb7a25]
  - @amritk/helpers@0.12.0

## 0.11.4

### Patch Changes

- Updated dependencies [91dab2b]
- Updated dependencies [9253843]
  - @amritk/helpers@0.11.0

## 0.11.3

### Patch Changes

- Updated dependencies [02f6b05]
  - @amritk/helpers@0.10.3

## 0.11.2

### Patch Changes

- 1efd6e8: Close generated-parser gaps reported from downstream use:

  - **Recursive discriminated `$ref` unions** are now validated. A top-level
    `oneOf`/`anyOf` of `$ref` branches sharing a discriminator dispatches to the
    branch parsers (e.g. `_disc === "lit" ? parseLit(input) : …`) in both strict and
    non-strict mode, instead of emitting a blind `input as T` cast that let
    mis-shaped values through. A `const` discriminator tag is also predicable now,
    so a discriminated branch's shape validator is a real predicate rather than the
    `=> false` stub.
  - **Strict parsers enforce array constraints** (`minItems`/`maxItems`/
    `uniqueItems`), which were silently unenforced even in `--strict`.
  - **Node ESM imports**: all emitted relative imports carry a `.js` extension
    (cross-file `$ref` imports, the index barrel, embedded `_helpers`, the
    validators' `validation-result`, and the examples' arbitrary imports). Node's
    ESM resolver rejects extensionless relative specifiers.
  - **Embedded-mode packaging**: `@amritk/helpers` now publishes its `src/*.ts`
    helper sources, and parser generation falls back to the always-published
    compiled `dist/*.js` when they are absent — fixing the `bunx mjst` crash that
    read an unpublished `src/is-object.ts`.

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

- Updated dependencies [1efd6e8]
- Updated dependencies [c288a90]
  - @amritk/helpers@0.10.2

## 0.11.1

### Patch Changes

- Updated dependencies [7d43e6f]
  - @amritk/helpers@0.10.1

## 0.11.0

### Minor Changes

- fadf545: Enforce the array and combinator keywords the generator previously parsed but
  ignored, proven against Ajv by the differential fuzz test:

  - Array: `minItems`, `maxItems`, `uniqueItems` (dedupes by a JSON projection —
    exact for primitives, the same projection the boolean guard uses),
    `contains` / `minContains` / `maxContains`, and tuple `prefixItems` with a
    length cap from `items: false` / `additionalItems: false`.
  - Combinators: `allOf` (conjunction, errors surfaced per branch), `anyOf`,
    `oneOf` (exactly one), `not`, and `if` / `then` / `else` — built on a shared
    "does this value match this subschema" boolean primitive — both as object
    properties and as a top-level schema.

  The generated `isX` type guard bails to the validator for schemas carrying any of
  these so it never disagrees with the slow path. Still out of scope: validating
  constraints on a top-level non-object schema (e.g. a root `{ type: 'array',
minItems }`), and `$ref` inside a `contains` / combinator branch in single-file
  output (it requires the referenced validator to be in scope).

- 26732dd: Generated validators now enforce several constraints they previously accepted
  silently, closing gaps a new Ajv differential fuzz test surfaced:

  - `patternProperties` values and a schema-form `additionalProperties` are now
    validated (previously only `additionalProperties: false` was enforced, so a
    value matching a pattern — or any extra key under an `additionalProperties`
    schema — passed unchecked).
  - `type: 'integer'` now rejects non-integral numbers, and `type: 'null'` is
    enforced, in both the validator and its boolean guard.
  - `required` keys with no `properties` entry now get a presence check.
  - `propertyNames` and `dependentRequired` are now enforced inside nested inline
    objects, not just at the root.

## 0.10.1

### Patch Changes

- 8a1a91e: perf: lazily allocate the validator's error array so valid input never builds
  one. Schemas too rich for the inline boolean guard (optional properties, enums,
  patterns, `$ref`s, unions) previously allocated an `errors` array on every call,
  including the happy path; they now create it only on the first actual error,
  mirroring the runtime interpreter's allocation-free valid path. Measured ~+45%
  throughput on a small object with an optional field and ~+6% on a nested order
  schema, with no change to the already-guarded all-required shapes.

  Also emit `enum` membership as a parenthesized `===` chain instead of a
  per-call `[...].includes(...)` array (allocation-free for primitive members),
  and fix a latent soundness gap in the boolean type-guard: array item checks now
  go through `Array.from` so a sparse array (a hole left by `delete arr[i]`) gets
  the same verdict as the error-collecting validator, which reads the hole as
  `undefined` and rejects it. `Array.prototype.every` skipped the hole and wrongly
  accepted it.

## 0.10.0

### Minor Changes

- 0db1446: Generate a boolean type-guard `isX(input): input is X` alongside every
  `validateX`. Where `validateX` returns a rich `ValidationResult` (and routes a
  failure to a separate error-collecting function), `isX` is a single flat boolean
  predicate — no error array, no cold-path call — so V8 inlines it like a
  hand-written `check`, matching the shape of TypeBox's compiled checker. It
  returns the _exact same verdict_ as `validateX` (constraints are emitted as the
  negation of the validator's error condition, so even edge values like `NaN` on a
  constrained number agree); when a schema carries something the flat form can't
  mirror ($ref, unions, `const`, x-mjst, pattern/dependent keywords), `isX` falls
  back to `validateX(input) === true`, which is always correct. The guard is
  re-exported from the generated `index`, giving consumers an allocation-free
  predicate for the common "is this valid?" check.

## 0.9.0

### Minor Changes

- f794ca6: Make generated object validators substantially faster on the happy path by
  reshaping the emitted function. `validateX` now keeps its boolean guard inlined
  as an early `return true` and delegates only the cold, error-collecting body to a
  separate function, so the hot path stays tiny enough for V8 to optimise well.
  The guard also drops the redundant `!Array.isArray(...)` term whenever a required
  property's `typeof` check already rejects arrays (kept when a `length`/index key
  could let an array through), and uses dotted property access for identifier keys.
  The exported API and `ValidationResult` contract are unchanged. On the
  `moltar/typescript-runtime-type-benchmarks` shapes this lifts steady-state
  valid-input throughput from ~59M to ~110M ops/s (loose) and ~39M to ~98M ops/s
  (strict), edging past typia.

## 0.8.0

### Minor Changes

- 89a445a: `additionalProperties: false` now respects `patternProperties` in both
  generators, matching the runtime interpreter: a key that matches any declared
  pattern is no longer treated as an undeclared key.

  - **Validators.** The unknown-key sweep exempts pattern-matched keys. The
    patterns are compiled once at module scope (the same regex caching the
    interpreter does) and a key survives the sweep if it is in the known-keys Set
    or matches any pattern.
  - **Parsers.** Schemas with `patternProperties` plus `additionalProperties:
false` previously kept every key via a blanket `...input` spread. The parser
    now builds a selective copy: declared properties and pattern-matched keys are
    kept (the first `$ref` pattern is still coerced through its imported parser),
    and keys matching neither are rejected in strict mode (`unknown property
"key"`) or stripped in coerce mode. This applies to both the combined
    (properties + patternProperties) and pattern-only parsers.

  The remaining scope edge is composition: schemas combining
  `additionalProperties: false` with `allOf`/`anyOf`/`oneOf` still skip the
  undeclared-key handling, since per JSON Schema `additionalProperties` does not
  see properties introduced by those branches and resolving them correctly is
  `unevaluatedProperties`-shaped work.

- 6fb26a2: Generated object validators now run an allocation-free boolean guard on the
  happy path. For all-required objects of bare-typed properties (and likewise
  nested objects), the validator first evaluates a single `&&` chain of `typeof`
  checks — with an `Object.keys().length === N` count standing in for the
  unknown-key sweep when the object is closed with `additionalProperties: false` —
  and returns `true` immediately when it passes. Only when the guard fails does
  execution fall through to the existing error-collecting body, so invalid input
  still gets full JSON-Pointer errors and every verdict is unchanged. The guard is
  emitted only when it can prove validity cheaply; schemas with constraints it
  can't express (patterns, ranges, enums, `$ref`, arrays, optional or extra-keyed
  objects) keep their previous output. On the
  `moltar/typescript-runtime-type-benchmarks` shape this moves valid-input
  throughput past TypeBox's compiled checker both with and without
  `additionalProperties: false`.

### Patch Changes

- cdfe681: Speed up the `additionalProperties: false` unknown-key sweep in generated
  parsers and validators. For objects with up to 16 declared properties, the
  sweep now tests each key against an inline chain of `!==` comparisons instead of
  a hoisted `Set.has` lookup — the shape Ajv and TypeBox compile to, which V8
  evaluates faster for small key counts and which avoids the per-module `Set`
  allocation. Objects with more declared keys keep the `Set` fallback.

  The shared logic lives in a new `@amritk/helpers/unknown-key-check` export so the
  parser's strict-mode, warning, and `patternProperties` combined sweeps and the
  validator's strict sweep stay in step (the combined parser uses the matching
  `isKnown` form to skip declared keys without a per-call `Set`). Roughly triples
  valid throughput on small strict schemas in the benchmark suite.

- Updated dependencies [cdfe681]
  - @amritk/helpers@0.10.0

## 0.7.0

### Minor Changes

- cff0369: Generated validators no longer silently skip checks that the runtime
  interpreter performs, closing two correctness gaps:

  - **Inline nested objects are validated recursively.** An object schema written
    directly under `properties` (rather than referenced via `$ref`) previously
    only produced an "is an object" shape check; its fields went completely
    unchecked. The generator now recurses to any depth, reporting errors at the
    correct nested JSON Pointer paths, and `$ref`s buried inside inline nested
    objects are collected as imports.
  - **`additionalProperties: false` is enforced.** Undeclared keys are now
    rejected with the interpreter's `must NOT have additional properties`
    message, at both the root and nested levels. The known-keys Set is hoisted to
    module scope and the sweep uses an allocation-free `for...in` loop, so the
    generated validators stay at Ajv-compiled speed. Schemas combining it with
    `patternProperties` skip the sweep for now, since the generator does not
    evaluate key patterns yet.

  Also fixes array item error paths, which duplicated the property name
  (`/tags/tags/0` instead of `/tags/0`), and updates the README benchmark tables:
  the old throughput numbers were inflated by the skipped nested checks.

  Inputs that previously passed validation against strict or nested schemas may
  now (correctly) fail.

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

- Updated dependencies [b0c83e7]
  - @amritk/helpers@0.9.0

## 0.6.0

### Minor Changes

- 51c2032: Close package gaps and add performance improvements.

  - **resolve-refs:** the SSRF guard now follows redirects manually and re-checks
    every hop (an allow-listed host can no longer bounce to a private/metadata
    address), and detects IPv4-mapped IPv6 and decimal/octal/hex IPv4 encodings.
    Concurrent loads of the same remote URL are coalesced onto one request.
  - **runtime-validators:** adds `unevaluatedProperties` / `unevaluatedItems`
    (annotation tracking across `$ref`/`allOf`/`if`-`then`-`else`/`anyOf`/`oneOf`/
    `dependentSchemas`, matching Ajv), and a linear `uniqueItems` fast-path for
    all-primitive arrays.
  - **generate-validators:** validates `const`, `dependentRequired`, and
    `propertyNames` (pattern form); regex `pattern`s are now correctly escaped so
    patterns containing `/` (or backslashes) emit compiling literals.
  - **generate-parsers:** corrects regex `pattern` escaping (backslashes are no
    longer doubled, which previously turned `\d` into a literal backslash) via the
    shared `@amritk/helpers/escape-regex-pattern`.
  - **helpers:** new `escape-regex-pattern` export and `hasDependentRequired` /
    `hasPropertyNames` guards; `resolveDynamicRefs` now rewrites `$dynamicRef`s
    nested inside array keywords (`allOf`, `anyOf`, `oneOf`, `prefixItems`).
  - **cli:** invalid `--input` / `--helpers` values fail fast with a clear message
    instead of being silently dropped, and `tsc` build failures include the
    compiler output.
  - **adapters:** the Zod and Valibot adapters now report when an unrepresentable
    type is widened to "accept anything" instead of dropping it silently.

### Patch Changes

- Updated dependencies [51c2032]
  - @amritk/helpers@0.8.0

## 0.5.1

### Patch Changes

- 6218978: chore: version bumps
- Updated dependencies [6218978]
  - @amritk/helpers@0.7.1

## 0.5.0

### Minor Changes

- 6fdb8bf: Consolidate the `$ref`-graph traversal that the parser, validator, and example
  generators each re-implemented into a single shared `@amritk/helpers/walk-ref-graph`
  walker (plus `@amritk/helpers/generate-index-barrel` and
  `@amritk/helpers/extract-dynamic-anchor-defs`). The walker resolves the ref
  once and rewrites `$dynamicRef` → `$ref` in one place, and memoizes the
  draft-07 upgrade, dynamic-ref map, and each `resolveRef` / `extractRefs` per
  root document so running several generators over the same loaded schema does
  the expensive walking once.

  The validator and example generators now also seed `$dynamicAnchor`-only
  definitions (the parser generator already did), so a definition reachable only
  through `$dynamicRef` always gets its own generated file instead of being
  referenced without one.

### Patch Changes

- Updated dependencies [6fdb8bf]
  - @amritk/helpers@0.7.0

## 0.4.2

### Patch Changes

- 8cde234: Re-publish all packages.
- Updated dependencies [8cde234]
  - @amritk/helpers@0.6.2

## 0.4.1

### Patch Changes

- Updated dependencies [ccecc67]
  - @amritk/helpers@0.6.1

## 0.4.0

### Minor Changes

- 9fea346: Make the generated type-name suffix configurable and default it to no suffix.

  `refToName` previously always appended `Object` to every type name derived from
  a `$ref` (e.g. `Contact` → `ContactObject`). It now accepts an optional `suffix`
  that defaults to `''`, so generated types, parsers, and validators use the plain
  PascalCase name by default.

  A new `typeSuffix` option threads through the generators and the CLI
  (`--type-suffix <suffix>`) to restore or customize the suffix — pass
  `--type-suffix Object` to keep the previous `ContactObject` naming.

  **Breaking:** with no `typeSuffix` set, generated type/parser/validator names no
  longer include the `Object` suffix. Set `typeSuffix: 'Object'` (or
  `--type-suffix Object`) to preserve the old output.

### Patch Changes

- Updated dependencies [9fea346]
  - @amritk/helpers@0.6.0

## 0.3.1

### Patch Changes

- Updated dependencies [99f1876]
  - @amritk/helpers@0.5.0

## 0.3.0

### Minor Changes

- d5da63a: Add schema adapters so the CLI can ingest schemas from external libraries. The
  new `@amritk/adapters` package converts a source schema into Draft 2020-12 JSON
  Schema before generation, leaving the core pipeline untouched. The CLI gains
  `--input <format>` — `typebox`, `zod`, `valibot`, and `effect`, alongside the
  default `json` — and `--export <name>` to pick which export of a schema module
  to use.

  Each source library is an optional peer dependency loaded at runtime. The Zod
  (Zod 4 `toJSONSchema`) and Valibot (`@valibot/to-json-schema`) adapters map
  their date types to the same `x-mjst` instanceOf extension used by TypeBox
  dates; the Effect adapter (`JSONSchema.make`) passes through Effect's encoded
  representation. Constructs JSON Schema cannot express are preserved via the
  `x-mjst` extension, which the type generator, parsers, and validators
  understand.

  Constructs that JSON Schema cannot express (e.g. TypeBox's `Type.Date()`) are
  preserved via an `x-mjst` vendor extension. The type generator, parsers, and
  validators now understand `x-mjst: { instanceOf }`, emitting the class type, an
  `instanceof` check (with `Date` coercion in non-strict parsers), and a matching
  validator error.

### Patch Changes

- Updated dependencies [d5da63a]
  - @amritk/helpers@0.4.0

## 0.2.3

### Patch Changes

- Updated dependencies [83eb57a]
  - @amritk/helpers@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies [cbc0e4c]
  - @amritk/helpers@0.2.2

## 0.2.1

### Patch Changes

- dbf49bf: Republish via npm trusted publishing (OIDC).
- Updated dependencies [dbf49bf]
  - @amritk/helpers@0.2.1

## 0.2.0

### Minor Changes

- 53fa6bf: Initial public release of the mjst toolchain: a CLI plus libraries for generating TypeScript parsers, validators, and markdown documentation from JSON Schemas.

### Patch Changes

- ad1efe5: chore: initial release
- Updated dependencies [ad1efe5]
- Updated dependencies [53fa6bf]
  - @amritk/helpers@0.2.0
