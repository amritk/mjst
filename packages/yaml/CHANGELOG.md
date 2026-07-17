# @amritk/yaml

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
