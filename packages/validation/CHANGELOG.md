# @amritk/validation

## 0.3.1

### Patch Changes

- 2c9b852: An `x-mjst` holding only documentation settings (`hidden`, `markdown`) no longer changes generated code. The validator generator and the type generator used to treat the presence of `x-mjst` as a keyword that shapes a node, so a root `$ref` that named its docs pages lost its one-line delegation, and an `if` fragment carrying a docs setting dropped its conditional from the TypeScript type. They now ask whether `x-mjst` carries a generator hint (`instanceOf`, `primitive`, `brand`, `discriminator`), via the new `hasMjstHint` in `@amritk/helpers/mjst-extension`.
- Updated dependencies [2c9b852]
  - @amritk/helpers@0.23.2

## 0.3.0

### Minor Changes

- 6453b6d: Rename `@amritk/parsers` to `@amritk/validation`.

  The package composes two engines and reaches seven modes — `types`, `guard`,
  `validate`, `check`, `coerce`, `repair`, `parse` — and `parsers` named the one of
  them its dominant engine cannot express. Six of the seven come from the validator
  engine; the parser engine supplies `parse` alone, and the package's own default
  (`['types', 'guard', 'validate']`) emits no parser at all, so the name described
  a mode that is absent from a default build.

  Nothing moves but the name. No export, option, mode or emitted byte changes, and
  `@amritk/parsers` never reached npm — the release that would have published it
  failed on that package alone, so there is no deprecation to follow and no
  version of it for anyone to be holding.

### Patch Changes

- 845f625: Take the first `examples` entry that is an instance of the declared type, rather
  than the first one outright.

  `getDefaultValue` is the single table both engines repair toward, and its
  `default` branch has long been guarded: a `default` left over from an earlier
  shape is ignored unless it matches the type the schema declares, because
  honouring one repairs a missing value into something the schema itself rejects.
  The `examples` branch had no such guard, and examples are the likelier source of
  the problem — they are illustrative rather than load-bearing, so they drift out
  of step with the schema they document, and OpenAPI descriptions are full of them.

  The visible failure is a generated file that does not compile. `examples` does
  not drive the emitted type, so `{ type: 'integer', examples: ['abc'] }` still
  emits `n: number` while the fallback literal becomes `"abc"`, and the parser
  returns that literal uncast on its non-object path:

  ```
  doc.ts: Type 'string' is not assignable to type 'number'. (TS2322)
  ```

  The repairing validator does not fail to compile — it inlines the same literal in
  a position typed loosely enough to accept it — but it returns `valid: false` with
  the mistyped value in hand, declining a repair that the type-based fallback would
  have completed.

  A list is now scanned for the first usable entry instead of being abandoned at a
  bad first one, so `examples: ['abc', 7]` repairs to `7`.

  `const` and `enum` are deliberately left unguarded. They _drive_ the emitted type
  — `{ type: 'integer', const: 'abc' }` emits `'abc'`, not `number` — so their value
  agrees with the type by construction, and falling through to a type-based
  fallback would create the mismatch rather than avoid it.

  Pinned by the parser suite's type-check pass, which compiles the emitted files
  under the repo's own strict flags and fails on the `TS2322` without the fix.

- Updated dependencies [845f625]
  - @amritk/helpers@0.23.1

## 0.2.0

### Minor Changes

- 9b0fb68: Close the parity gaps that stood between `@amritk/validation` and retiring the two
  generators it composes, and give generated validators an `importExt`.

  Three options had no route through the facade — `importExt` and `logWarnings`
  from the parser generator, and, underneath that, the validator generator had no
  `importExt` at all: it hardcoded `.js` on every emitted specifier. That was
  survivable while the CLI kept the two outputs in separate trees. It is not
  survivable in one shared directory, which is what `@amritk/validation` emits: asking
  for `importExt: 'ts'` would have produced parser files saying `.ts` beside
  validator files saying `.js`, a set that resolves under neither Node's type
  stripping nor a compiled build. `buildValidatorSchema` now takes `importExt` as a
  trailing argument (defaulting to `'js'`, so nothing existing moves) and threads it
  through the per-file imports, the cross-`$ref` imports, the `formats.ts` import
  and the barrel.

  The parity itself is now a test rather than a claim. Every option of both
  generators is exercised through the facade and through the direct call, and the
  two file sets are compared by fingerprint — an option with no route through the
  facade is a capability that would be lost when the packages go, and a route that
  produces _different_ bytes is worse than none, because it looks like it works.
  Alongside it, two tests on the emitted specifiers: that one build uses one
  extension throughout, and that every relative specifier resolves to a file the
  same build actually emitted.

- fcb615d: Explain a failing `anyOf` / `oneOf` with the errors of the branch that was
  plainly the one meant. In generated validators this is `--branch-errors`, off by
  default; the interpreter does it always, on the cold path it already had.

  "must match a schema in anyOf" names no field and no reason. The branch errors
  are computed anyway to answer the yes/no question, and generated validators threw
  all of them away — so a typo in one field of a union-rooted definition pointed at
  the whole object rather than at the field.

  Both now select a branch by the same rule. Branches that rejected the value's
  _kind_ are dropped first: a branch wanting a string has nothing to say about an
  object, which leaves a `string | { … }` union — the commonest shape in a
  hand-written config schema — with the one branch that was talking about this
  value. When several survive they all describe the same kind of value, and the tie
  is broken the way a discriminated union reads from the outside. Nothing extra is
  reported when no branch stands out; "the branch with the fewest errors" would
  answer here too, and answers wrongly on `oneOf: [aReference, theActualThing]`.

  **Why it is a flag.** Collecting branch errors costs about 30% of the throughput
  of a _valid_ instance against a union-rooted schema, because each branch is
  handed a collector it closes over. Off, the generated code is exactly what it
  would be without the option — no buffer, no collector, byte for byte. On, the
  buffer is created by the first branch that has something to put in it, so a value
  matching the first branch still allocates nothing; an eagerly-created one cost
  40% rather than 30%.

  The combinator's own error still comes first, so code matching on `keyword ===
'anyOf'` is unaffected. Errors a reported branch produces now carry their real
  instance path.

- cacfeae: Move both generator engines into `@amritk/validation` as internal modules.

  The parser/type engine now lives at `src/parsers/` and the validator/coercer/
  repairer engine at `src/validators/`, reached through the `#parsers/*` and
  `#validators/*` subpath imports. `@amritk/validation` no longer depends on
  `@amritk/generate-parsers` or `@amritk/generate-validators`; it owns the code
  those packages used to hold.

  Nothing changes for consumers of `@amritk/validation`: `generate`, `ALL_MODES`,
  `GeneratedFile`, `GenerateOptions`, `Mode` and `ImportExtension` are the same,
  and the generated output is byte-identical.

  `@amritk/generate-parsers` and `@amritk/generate-validators` keep their public
  API — `buildSchema` and `buildValidatorSchema` behave exactly as before — but
  are now thin forwarding shims over the moved engines, re-exported through the
  new `@amritk/validation/internal/parsers` and `@amritk/validation/internal/validators`
  entry points. Both packages are being retired; import `@amritk/validation`
  instead.

- e786470: New package: `@amritk/validation`, one surface over every mode mjst can generate.

  Until now the matrix was split across two packages with two long positional
  argument lists, and reaching a given cell meant knowing which package owned it.
  This is the front door:

  | mode          | function    | value back | tells you              | stops at          |
  | :------------ | :---------- | :--------- | :--------------------- | :---------------- |
  | `types`       | —           | —          | —                      | —                 |
  | `guard`       | `isX`       | —          | a boolean              | the first problem |
  | `validate`    | `validateX` | —          | every error            | the end           |
  | `coerce`      | `coerceX`   | coerced    | every error            | the end           |
  | `repair`      | `repairX`   | repaired   | repairs **and** errors | the end           |
  | `parse`       | `parseX`    | repaired   | nothing                | never fails       |
  | `parseStrict` | `parseX`    | as given   | throws the first       | the first problem |

  One options object, and a default of `['types', 'guard', 'validate']` — the modes
  that only read a document. Anything that rewrites one is opt-in, because a
  generator that quietly starts repairing is not one you can trust by default.
  `parse` and `parseStrict` are one function name under two contracts, so asking
  for both throws rather than silently picking.

  **It composes the two engines, it does not replace them.** They emit genuinely
  different code for the value-producing modes — a parser fuses building the output
  with checking it and is several times faster for it, while a validator keeps the
  passes apart and can therefore report — so collapsing them into one emitter would
  mean giving up one of those properties. Both stay, and this spends the cost on
  reconciling their output instead, which is bounded and testable.

  What makes one output directory possible is that both derive the type from the
  same `@amritk/helpers/generate-type-definition`, byte for byte. So the type is
  declared **once**, in `x.ts` next to the validator half, and the parser half lands
  in `x.parse.ts` importing it. There is exactly one `export type X` in the output
  whatever combination of modes you ask for — asserted over a corpus of schema
  shapes by compiling the result under this repo's own flags, `noUnusedLocals`
  included, and then linking and calling it.

  **It is not faster, and it should not be.** Ask it for one mode and it emits the
  exact bytes the package that owns that mode would have emitted, which is pinned
  per mode by fingerprint. Identical code cannot run at a different speed, so there
  is no runtime claim here. What changes is cold: the whole matrix costs slightly
  less to generate (2.9 ms → 2.7 ms), lands in six files instead of seven, and
  declares the type once instead of twice. A build that asks for no validator mode
  now also ships no `validation-result.ts`, where composing by hand would have left
  17 KiB of error types nothing could import.

  Also: the rehoming step recognises a sibling import by regex rather than by the
  obvious `line.includes("from './")`. `tsc-alias -f` rewrites that literal in the
  compiled output — it cannot tell a string that merely looks like an import
  specifier from a real one — turning the predicate into one that is never true.
  Nothing failed loudly, because every test in this repo aliases workspace packages
  to `src`; the suite stayed green while the built package emitted parser files
  importing names from the validator file that does not export them. A dist-level
  smoke test now asserts the built artifact still rehomes, since only running the
  built code can catch it.

- 5c0f50f: Add a fail-fast validation mode: a generated `checkX` that stops at the first
  violation and reports it.

  Between `isX`, which short-circuits and tells you nothing, and `validateX`,
  which walks the whole document to collect every error, there was nothing — no
  equivalent of Ajv's `allErrors: false`. Composing the two does not work:
  `isX(v) ? true : validateX(v)` pays for both passes and measures no faster than
  `validateX` alone on failing input. So this is a real emitter rather than a
  wrapper.

  `checkX(input, _path?)` returns the same `ValidationResult` as `validateX`, with
  an `errors` array holding exactly one error — the one `validateX` would have
  reported first, identical down to its path, keyword and params. Same type on
  purpose: a caller that already renders a `ValidationResult` renders this one
  with the code it has. Reach it with a trailing `check` argument to
  `buildValidatorSchema` (default `false`, nothing existing moves) or the new
  `'check'` mode on `@amritk/validation`.

  On the bench corpus it is 2.5x to 4.7x the throughput of `validateX` on invalid
  input, and a wash on valid input where there is nothing to skip. A handful of
  unsatisfiable shapes cannot take the short-circuiting form — an `allOf: [false]`,
  an always-matching `not`, an `anyOf` whose every branch is statically
  impossible — because their report is a `return` no runtime condition guards and
  everything behind it is code the consumer's build calls unreachable. Those are
  detected while generating, and `checkX` runs `validateX` and hands back its first
  error instead: same contract, no short circuit.

- f699039: Retire `@amritk/generate-parsers` and `@amritk/generate-validators`, and drop the
  two internal subpath exports that existed only for them.

  Both engines moved into `@amritk/validation` in the previous change, leaving those
  packages as forwarding shims. The shims are gone: both directories are now
  private and hold nothing but their published `CHANGELOG.md`, a deprecation
  notice pointing at `@amritk/validation`, and the manifest needed to run
  `npm deprecate` against the versions already on npm. Nothing new is published
  from either.

  **Breaking, for anyone who found them:** `@amritk/validation/internal/parsers` and
  `@amritk/validation/internal/validators` are removed. They were never a supported
  entry point — they existed so the shims could reach the engines through the
  package boundary — and with the shims retired there is nothing left to reach
  them. The engines stay internal, reached through `#parsers/*` and
  `#validators/*` inside the package.

  Nothing else changes: `generate`, `ALL_MODES`, `GeneratedFile`,
  `GenerateOptions`, `Mode` and `ImportExtension` are the same, and the generated
  output is byte-identical.

  Migrating off the retired packages:

  ```ts
  // before
  import { buildSchema } from "@amritk/generate-parsers";
  const files = await buildSchema(schema, "Document");

  // after
  import { generate } from "@amritk/validation";
  const files = await generate(schema, "Document", { modes: ["parse"] });
  ```

  ```ts
  // before
  import { buildValidatorSchema } from "@amritk/generate-validators";
  const files = await buildValidatorSchema(schema, "Document");

  // after
  import { generate } from "@amritk/validation";
  const files = await generate(schema, "Document"); // types + guard + validate
  ```

- 3a26591: Add `--repair`: validators that coerce, validate, and then repair — reporting the
  errors they repaired.

  `--coerce` moves a value that is already right but written in the wrong type, and
  substitutes nothing. A coercing parser substitutes freely and reports nothing. The
  gap between them is the common case: a document you want to accept as far as it
  can be accepted, while still being told what you had to accept it _despite_.

  `repairX(input)` returns `RepairResult<T>` — `{ valid: true, value, repairs }`, or
  `{ valid: false, value, errors, repairs }` when something could not be repaired. It
  coerces, runs the very same `validateX`, repairs each rejected position to a value
  the schema itself supplies — a `default`, a `const`, the first `enum` member, or a
  fallback built to satisfy that position's own bounds — and re-validates, until the
  document is accepted or nothing further can be repaired.

  **The repairs are the validator's own errors.** Not a parallel account of what went
  wrong, but the same objects, with the same `path`, `keyword` and `params` the value
  would have been rejected with. That is the point of driving repair from the errors
  rather than threading a collector through the emitters: a caller logging a repair
  logs exactly what a rejection would have said, and the two cannot drift apart
  because there is only one of them.

  Read the verdict by the tolerance you want. A document needing nothing is `valid:
true` with an empty `repairs`. One fully repaired is `valid: true` with a non-empty
  one, so `valid` alone does not tell you the input was clean — check `repairs.length`
  when that matters. One that could not be fully repaired is `valid: false` carrying
  both what was repaired and what is still wrong with the value handed back.

  **How much it will substitute.** Everything `@amritk/generate-parsers` substitutes in
  its coercing mode, down to fabricating an `"xxx"` for a `minLength: 3` and building a
  whole object for a root that arrived as `"nope"`. A differential test pins that: the
  same schema and the same document through both engines produce the same result. They
  can, because `getDefaultValue` and `generateDefaultFromPattern` moved into
  `@amritk/helpers` and both now read one table rather than two that agree today. The
  one deliberate difference is `minItems`, where a short array is padded here and left
  short by the parser — so the parser can hand back a document its own schema rejects
  and this cannot.

  The input is never modified, everything a repair did not touch is shared rather than
  copied, a position is repaired at most once so an unsatisfiable schema reports rather
  than spins, and whatever comes back `valid: true` is a value `validateX` accepts.

  Off by default; on the CLI it is `--repair`, which implies `--coerce` and needs
  `--validators`. Also documents `coerce` and `branchErrors` in the
  `buildValidatorSchema` signature, which the README and AI.md had not caught up with.

- 3670138: Add `--coerce`: generated validators that coerce scalars toward what the schema
  declares, and then validate.

  For every type `X`, a `coerceX(input) => { valid: true, value } | { valid:
false, errors }` is emitted alongside the existing `validateX` and `isX`, which
  are unchanged. Off by default and free when off.

  **Nothing is substituted.** A value that cannot be coerced into a valid one
  reaches the validator untouched, so the error names what the caller actually
  wrote, with the keyword and params that rejected it. `maxRetries: "many"` is an
  error, not a `0`. And the constraint keywords run on the coerced value, so `"3"`
  against `{ type: 'integer', minimum: 5 }` becomes `3` and _then_ fails
  `minimum` — an answer neither a strict parser nor a repairing one can give.

  **The input is never modified.** `value` is the input itself when nothing needed
  coercing, and otherwise a copy sharing everything the coercion did not touch, so
  callers do not pay for the defensive clone an in-place coercer forces.

  **More precise than Ajv, in the safe direction.** The table is Ajv's
  `coerceTypes` minus the cells where Ajv guesses: no whitespace-to-zero
  (`Number(" ")` is `0`), no `0x`/`Infinity` strings, no trailing-point numerals,
  and nothing coerced to or from `null` — `null` is a JSON value in its own right
  and usually means "not set". Every value this coerces, Ajv coerces to the same
  value, which is pinned as a property over the whole table and structurally over
  a fuzz: a migration off Ajv never changes a value, it turns some of Ajv's silent
  repairs into errors instead. Leading zeros and exponents stay, both being
  ordinary ways to write a number in a YAML file.

  **Unions are coerced when the answer is forced.** At a position offering several
  scalar types — an array-form `type`, or a union of scalar branches — the value is
  coerced only if exactly one of them can take it, so `string | { … }` turns `7`
  into `"7"` while `number | string` leaves `true` alone and lets the validator
  say what is wrong with it. A value that is already one of the offered types is
  left alone. Ajv instead walks its own coercion list in order, which makes `"1"` a
  number under `["number", "string"]` and a string under `["string", "number"]`;
  the answer should not depend on the order the union was written in.

### Patch Changes

- Updated dependencies [9a1260e]
- Updated dependencies [3a26591]
  - @amritk/helpers@0.23.0
