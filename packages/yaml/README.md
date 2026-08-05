<div align="center">

# @amritk/yaml

**The featherweight YAML parser built for OpenAPI tooling — fast, zero-dependency, and it never loses track of where a value came from, down to the column.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/npm/v/@amritk/yaml?style=flat-square&logo=npm&logoColor=white&label=version&color=6366f1)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![dependencies](https://img.shields.io/badge/dependencies-0-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/yaml` parses YAML into a JavaScript value **and** a lightweight tree where **every node records the exact source it came from** — a `start` offset (inclusive) and an `end` offset (exclusive). That second part is the whole point: a linter or language server needs to put a squiggle at an exact `line:column`, and most fast YAML parsers throw position information away.

It is **zero-dependency** and tuned to be **small and fast**. Against the two parsers people reach for on the web:

- **vs [`yaml`](https://www.npmjs.com/package/yaml) (eemeli)** — the only other parser here that also tracks source positions — building the source-mapped tree is **~30–40× faster**, and the bundle is **~3.4× smaller**.
- **vs [`js-yaml`](https://www.npmjs.com/package/js-yaml)** — which has **no concept of source positions** — parsing straight to data is **~1.6–1.9× faster**, the bundle is **~1.4× smaller**, and we *also* hand you the positioned tree it cannot produce.

It passes **397 of the 402 cases** in the official YAML test suite, with every
remaining case [written down and explained](#conformance-measured) rather than
left to chance.

It targets the YAML that real configuration and OpenAPI documents use: block and flow collections, all three quoting styles, literal/folded block scalars with chomping, comments, anchors, aliases, merge keys, explicit `? key` / `: value` entries, and multi-document (`---`-separated) streams. Scalars resolve via the YAML 1.2 **core schema** — so an OpenAPI `version: 1.0.0` stays the string `"1.0.0"` instead of turning into a number — and the core-schema `!!` tags (`!!str`, `!!int`, `!!float`, `!!bool`, `!!null`) coerce a value when written.

**OpenAPI compatibility.** OpenAPI restricts its YAML to the JSON-compatible subset — *"tags MUST be limited to those allowed by the JSON Schema ruleset"* and map keys must be scalar strings — and that subset is exactly what's covered above. Keeping `version: 1.0.0` a string (rather than a float) and *not* coercing untagged ISO dates into `Date`s is the correct, round-trip-safe behavior an OpenAPI tool needs.

**JSON in, same value out.** YAML 1.2 is a strict superset of JSON, so a `.json` document goes through this parser and comes out as `JSON.parse` would have produced it — which is what lets `@amritk/lint` route both formats through one code path and lets a `$ref` point at either. That is checked rather than assumed: `src/json-superset.test.ts` runs a generated corpus (every value in six spellings — compact, 2-space, **tab-indented**, CRLF, and with leading/trailing blank lines) against `JSON.parse` and requires an identical value *and* zero diagnostics for each, and `@amritk/lint` pins the two parsers to identical data, diagnostics, and `line:column` ranges for every path in a JSON document.

Beyond that JSON-compatible core, the common extended tags resolve too, for general config files (Kubernetes, CI, Ansible) that use them — matching `yaml` (eemeli): `!!binary` → `Uint8Array`, `!!timestamp` → `Date`, `!!set` → `Set`, and `!!omap` → `Map`. These fire only on an *explicit* tag, so they never change how a tagless OpenAPI document parses. (A conformant OpenAPI spec won't contain them.)

---

## Installation

```bash
npm install @amritk/yaml
# or
pnpm add @amritk/yaml
# or
bun add @amritk/yaml
```

---

## Usage

### Parse to data

```ts
import { parse } from '@amritk/yaml'

parse('openapi: 3.1.0\ninfo:\n  title: My API\n')
// → { openapi: '3.1.0', info: { title: 'My API' } }
```

### Parse with source positions (the diagnostics path)

```ts
import { lineCounter, nodeAtPath, parseDocument } from '@amritk/yaml'

const source = 'info:\n  title: My API\n  version: 1.0.0\n'
const doc = parseDocument(source)

// Walk to a value by its JSON path and read its exact span.
const node = nodeAtPath(doc.contents, ['info', 'version'])
const lc = lineCounter(source)

lc.linePos(node.start) // → { line: 3, col: 12 }  (1-based)
lc.linePos(node.end) // → { line: 3, col: 17 }

// Parser-level problems (duplicate keys, unterminated flow, …) come with spans too.
for (const error of doc.errors) {
  const { line, col } = lc.linePos(error.start)
  console.error(`${line}:${col} ${error.message}`)
}
```

`nodeAtPath(root, path, closest)` returns the node at a JSON path, or — with `closest: true` — the nearest existing ancestor, so a diagnostic can still point somewhere real when the exact path is missing.

### Parse a multi-document stream

```ts
import { parseAllDocuments } from '@amritk/yaml'

const docs = parseAllDocuments('kind: Service\n---\nkind: Deployment\n')
docs.map((d) => d.toJS())
// → [{ kind: 'Service' }, { kind: 'Deployment' }]
```

Each document gets its own `contents`, `errors`, `warnings`, and anchor scope (an alias in one document does not resolve an anchor declared in another). `parseDocument` reads only the first document of a stream, and warns (`MULTIPLE_DOCUMENTS`) when it had to leave one behind.

### Walk the tree

The node guards mirror the mainstream `yaml` package, so traversal code is mechanical:

```ts
import { isMap, isScalar, isSeq, parseDocument } from '@amritk/yaml'

const { contents } = parseDocument(source)
if (isMap(contents)) {
  for (const pair of contents.items) {
    if (isScalar(pair.key)) console.log(pair.key.value, pair.value?.start, pair.value?.end)
  }
}
```

---

## API

| Export | What it does |
| --- | --- |
| `parse(source, options?)` | Parse straight to a JavaScript value, like `JSON.parse`. |
| `parseDocument(source, options?)` | Parse to `{ contents, errors, warnings, toJS() }` where every node carries `start`/`end` source offsets. |
| `parseAllDocuments(source, options?)` | Parse a multi-document (`---`-separated) stream to an array of documents, each with its own anchors and problems. |
| `nodeAtPath(root, path, closest?)` | Resolve a JSON path to its node (carrying `start`/`end`), optionally falling back to the closest ancestor. |
| `lineCounter(source)` | Build an `offset → { line, col }` mapper (1-based). |
| `keyText(node)` | The string a mapping key projects to in `toJS()` output — the same string `nodeAtPath` matches a path segment against. Use it when you walk the tree yourself and need your paths to line up with the projected data. |
| `isScalar` / `isMap` / `isSeq` / `isPair` / `isAlias` | Narrowing guards over the node union. |

**Options**

- `uniqueKeys` (default `true`) — report duplicate mapping keys as errors. Set `false` to allow them (last value wins).
- `merge` (default `true`) — honor the `<<` merge key. Set `false` to treat `<<` as an ordinary key.

---

## Performance

Run it yourself with `bun run bench`. Numbers below are a median of three runs
on one Linux x64 machine under Bun — treat the ratios as the durable part and
the absolute throughput as a property of that box.

**Parse to a source-mapped tree** — the job this package exists for. `js-yaml` cannot produce positions, so it is not a candidate here.

| fixture | @amritk/yaml | yaml (eemeli) | speedup |
| --- | --- | --- | --- |
| small (155 B) | 356k ops/s | 11.0k ops/s | **32.3×** |
| medium (2 KB) | 36.0k ops/s | 932 ops/s | **38.6×** |
| large (100 KB) | 690 ops/s | 21.0 ops/s | **32.9×** |

**Parse to plain data** — all three can do this.

| fixture | @amritk/yaml | yaml | js-yaml | vs yaml | vs js-yaml |
| --- | --- | --- | --- | --- | --- |
| small | 255k | 12.2k | 150k | 20.9× | 1.69× |
| medium | 23.8k | 953 | 12.4k | 25.0× | 1.92× |
| large | 410 | 21.7 | 256 | 18.9× | 1.60× |

**Bundle size** (minified + gzipped) — what each parser adds to an application
that imports it. The bench bundles a small consumer of each library rather than
the library's own entry point, so the numbers reflect code that is actually
reachable. Ours covers the full surface (`parse`, `parseDocument`, `nodeAtPath`,
`lineCounter`); `js-yaml` gets only `load`, because it has no positioned-tree
equivalent to import.

| | size | |
| --- | --- | --- |
| **@amritk/yaml** | **10.4 KB** | — |
| yaml | 35.5 KB | 3.4× larger |
| js-yaml | 14.4 KB | 1.4× larger |

Correctness is pinned three ways: a differential test suite (`src/differential.test.ts`) parses a battery of documents — including full OpenAPI specs — and asserts byte-identical data output against `yaml`; `src/json-superset.test.ts` holds a generated JSON corpus to `JSON.parse` exactly; and `src/conformance.test.ts` measures the parser against the official YAML test suite (see [Conformance, measured](#conformance-measured)). Where `js-yaml` diverges (its `!!timestamp` type turns ISO strings into `Date`s, which is wrong for a JSON superset), we instead agree with `yaml`.

---

## Scope

This is **not** a fully conformant YAML 1.2 processor. It implements the subset
that real configuration and OpenAPI documents use, plus the YAML 1.2 **core
schema** for scalar typing. The exact boundaries:

### Supported

**Structure**

- Block mappings (`key: value`) and block sequences (`- item`), nested arbitrarily.
- Flow mappings `{ … }` and flow sequences `[ … ]`, including spanning multiple lines (split at token boundaries) and trailing commas.
- Implicit single-pair entries inside a flow sequence (`[ key: value ]`).
- Explicit `? key` / `: value` entries, including block and complex (map/seq) keys. A flow collection on either side (`? {x: 1}`, `: [a, b]`) is parsed as the collection it is — its own `: ` separators are not mistaken for the entry's.
- Empty nodes, wherever the grammar allows one: a `-` or `key:` with nothing after it, and an entry carrying only node properties (`- !!str`, `- &x`) — which is an empty *tagged or anchored* node, so the entries that follow it stay its siblings rather than becoming its content.

**Scalars**

- Plain (unquoted), single-quoted (`''` escape), and double-quoted scalars (full escapes — `\n`, `\t`, `\xNN`, `\uNNNN`, `\UNNNNNNNN` — line continuation, and folding).
- Literal `|` and folded `>` block scalars with chomping (`-` strip, `+` keep, default clip) and explicit indentation indicators.
- Multi-line plain scalars (folded) in both block context and flow context (`[ … ]` / `{ … }`), where a wrapped line's indentation is trimmed and line breaks fold per YAML 1.2 (single break → space, a run of *n* breaks → *n − 1* newlines).

**Type resolution (YAML 1.2 core schema)**

- `null` (`null`/`Null`/`NULL`/`~`/empty), booleans (`true`/`false` and case variants), integers (decimal, `0x` hex, `0o` octal), floats (including `.inf`/`-.inf`/`.nan`); everything else is a string. So `version: 1.0.0` stays the string `"1.0.0"`.

**Tags**

- Core scalar tags (the JSON-compatible set OpenAPI allows): `!!str`, `!!int`, `!!float`, `!!bool`, `!!null`. A core tag **coerces** what it is written on rather than only confirming it: `!!int "7"` is `7`, `!!bool "FALSE"` is `false`, `!!float 1` is `1` (an integer form is a valid float), and `!!null x` is `null`. The tag is the author saying what the value is.
- Extended tags, for general config files beyond the OpenAPI subset: `!!binary` → `Uint8Array`, `!!timestamp` → `Date`, `!!set` → `Set`, `!!omap` → `Map` (matching `yaml`). A conformant OpenAPI document won't use these.
- All three spellings resolve to the same tag: the shorthand `!!str`, the verbatim `!<tag:yaml.org,2002:str>`, and a shorthand through a handle a `%TAG` directive declared.
- The non-specific `!` resolves a scalar as a string, per the failsafe schema.
- Any other tag is **captured on the node** (readable via `node.tag`) and its value passed through unchanged. A *local* tag keeps its `!` — `node.tag` is `!custom` for `!custom`, versus `str` for `!!str` — so an application tag that happens to share a core tag's name does not coerce.

**References, documents, and trivia**

- Anchors (`&name`) and aliases (`*name`); `<<` merge keys (toggle with the `merge` option). Anchors and aliases work as mapping keys, and an alias key resolves to the anchored value.
- Node properties written on a mapping key (`&a key: value`, `!!str 23: v`) apply to **the key**, so a later `*a` resolves to the key — not to the mapping it opens. Properties on a line of their own above the mapping describe the mapping itself.
- Collections as mapping keys, both explicit (`? [a, b]` / `: value`) and implicit (`[a, b]: value`), in any entry position. A JavaScript object can only be keyed by a string, so a collection key projects to its flow rendering — `{ '[ a, b ]': 'value' }` — and two keys that render alike are reported as duplicates, because in the projection they are.
- Compact block collections opened on an explicit entry's introducer line — `? a` / `: - one` is a sequence, `? earth: blue` a mapping — with their remaining entries aligned under that first one.
- Multi-document streams (`---` / `...`) via `parseAllDocuments`, each document with its own anchor scope, tag handles, and problem list.
- A root node written on the `---` line itself — `--- foo`, `--- |`, `--- !!str`, or a quoted scalar spanning the lines below it. Its content is measured against column 0, not the column the marker pushed it to, so `--- >` may hold a block scalar starting at column 0.
- `%TAG` directives (handles are resolved) and `%YAML` (the version is reported, not applied — resolution is always the 1.2 core schema).
- Comments (full-line and inline), blank lines, and a leading byte-order mark.
- All three YAML line breaks — `\n`, `\r\n`, and a lone `\r` — count as one break each, in the parser and in `lineCounter`'s positions.

**Diagnostics**

Every node carries an exact `[start, end)` source span, and problems are collected on `doc.errors` / `doc.warnings` rather than thrown.

| code | |
| --- | --- |
| `DUPLICATE_KEY` | the same mapping key appears twice — compared on the string the key projects to, so an alias to an anchored key and two collection keys with the same flow rendering both count |
| `UNRESOLVED_ALIAS` | `*name` with no matching anchor in scope |
| `UNTERMINATED_FLOW` | a `[` or `{` that never closes |
| `UNTERMINATED_QUOTE` | a quoted scalar that never closes |
| `UNEXPECTED_CONTENT` | content after a node ends, a second root node with no `---`, a block sequence opened on the line of the key it belongs to (`key: - a`), or a block mapping opened on the `---` line (`--- a: 1`, `--- [a, b]: v`) |
| `UNEXPECTED_COMMA` | an empty flow entry (`[1, , 2]`) |
| `TAB_INDENT` | a tab standing where indentation belongs — in a line's leading whitespace, in a block scalar's, or between an indicator and the compact collection it opens (`-\t- x`) |
| `BAD_SCALAR_START` | a plain scalar starting with the reserved `@` or `` ` ``, or a `-` where a flow entry belongs (`[-]`) |
| `BAD_SCALAR_CONTENT` | a `: ` inside a plain scalar, which the spec ends the scalar at (`a: b: c`, or a continuation line that reads as a mapping entry) |
| `BAD_COMMENT` | a `#` with no whitespace before it, so the rest of the line is not a comment (`"value"# …`) |
| `BAD_ESCAPE` | a `\` escape double-quoted YAML does not define (`"a\.b"`) |
| `BAD_BLOCK_HEADER` | a `|`/`>` header with a repeated indicator or trailing text (`|10`, `> text`) |
| `BAD_INDENT` | a block scalar's leading blank line reaching past its first content line, a quoted scalar continued at its parent's column, or a flow collection whose continuation lines do not clear the block that holds it |
| `BAD_IMPLICIT_KEY` | a key that does not fit on one line, a block key whose `:` sits more than 1024 characters in, or a `[ key\n : value ]` whose `:` is on the next line |
| `BAD_PROPERTY` | an anchor or tag on an alias, or two anchors on one scalar |
| `BAD_TAG` | a verbatim tag missing its closing `>`, or a tag holding a flow indicator |
| `UNKNOWN_TAG_HANDLE` | a tag handle no `%TAG` directive declared |
| `BAD_DIRECTIVE` | a malformed `%YAML` version, or content after it |
| `DUPLICATE_DIRECTIVE` | a second `%YAML` directive on one document |
| `UNEXPECTED_DIRECTIVE` | a directive with no `...` before it or no `---` after it |
| `DEPTH_LIMIT` | nesting past the parser's depth cap |

Warnings (advisory; the document still parses): `UNSUPPORTED_YAML_VERSION`, `UNKNOWN_DIRECTIVE`, a malformed `%TAG` directive (`BAD_DIRECTIVE`), and `MULTIPLE_DOCUMENTS` — `parseDocument` found a second document after a `---`/`...` marker and read only the first, so switch to `parseAllDocuments` if you want the rest.

### Not supported

- **Tab indentation.** Forbidden by YAML 1.2; reported as a `TAB_INDENT` error rather than parsed. Whether a given tab *is* indentation depends on the column it sits at, and that is now tracked: a tab is separation (and legal) once the spaces before it already satisfy the indentation the line owes its context, which is why `\t[a]` at the document root and a `foo:` whose value line reads `⟨space⟩⟨tab⟩bar` both parse clean, while `\tb:` under an `a:` does not. The rule is applied in a line's leading whitespace, inside a block scalar, in a flow collection's continuation lines, and in the separation between an indicator and a compact collection opened on its line (`-\t- x`).
- **Schema selection.** Always the 1.2 core schema — no JSON, failsafe, or YAML 1.1 schema switch. A `%YAML 1.1` document parses, with a warning that its schema differences are not applied.
- **YAML 1.1-only scalar forms.** `yes`/`no`/`on`/`off` booleans, sexagesimal numbers (`1:30:00`), and underscore digit groups (`1_000`) stay strings, per the 1.2 core schema.
- **Implicit timestamps.** An untagged ISO date string stays a string; only an explicit `!!timestamp` produces a `Date`.
- **Directives on a line a plain scalar could claim.** The rules around directives are enforced — a directive needs a `...` footer before it and a `---` after it, and its version must parse — with one exception: when the offending `%` line could equally be read as a continuation of the plain scalar above it, the scalar wins. Reporting it would mean rejecting a valid document (the suite's `XLQ9`) to catch an invalid one.
- **The 1024-character implicit key limit in flow context.** A block mapping key whose `:` sits more than 1024 characters in *is* reported (`BAD_IMPLICIT_KEY`). The spec writes the same cap into the flow-context production, and there it is deliberately not enforced: a flow mapping is where JSON lives, `{"…1100 characters…": 1}` is valid JSON, and rejecting a valid JSON document is the worse of the two errors. `yaml` (eemeli) draws the line in the same place.
- **Flow collection indentation, at the closing delimiter.** A flow collection's *content* lines must clear the indentation of the block that holds them, and a line that does not is reported (`BAD_INDENT`). Its **closing** `]`/`}` is held only to the parent's own column, one short of what the spec asks: closing a multi-line flow collection at the parent's column is how Prettier and hand-written manifests both write it, and `yaml` and `js-yaml` both accept it. A closing delimiter *further out* than its parent is still reported.
- **Shared alias identity.** An alias to a collection projects to a *copy*, not the same object: for `a: &x {p: 1}` / `b: *x` / `c: *x`, `b` and `c` are equal but `b !== c`, and mutating one does not change the other. The spec makes them one node. Copying keeps `toJS()` a plain tree — which is what a path-keyed position index, a JSON round-trip, and any consumer that edits the projection all assume — and the cost of re-expanding aliases is capped by an expansion budget, so a billion-laughs document throws a catchable error instead of hanging.

If you need full YAML 1.2 conformance, use [`yaml`](https://www.npmjs.com/package/yaml). If you need a small, fast, position-aware parser for diagnostics, use this.

### Conformance, measured

The boundary above is not a claim — it is checked. `src/conformance.test.ts` runs the
official [YAML test suite](https://github.com/yaml/yaml-test-suite) (402 cases) on
every build:

**397 / 402 cases pass (98.8%).**

Every case that does not is listed in `src/conformance-expected-failures.test-utils.ts`
with the reason it does not, and the test fails if a case moves in *either*
direction — a regression breaks the build, and so does a case that starts passing
without its entry being removed. The suite is a dev dependency; none of it reaches
the published bundle.

What is left is the irreducible part — no missing feature, just five cases where
the right answer is not the suite's:

- **`2JQS`** — `: a` / `: b`, two entries whose keys are both empty. The spec's own
  "keys are unique" rule makes that a duplicate; the suite only asks that the
  document compose, so it reads as valid there. `uniqueKeys` is on by default
  because a linter wants the report — `parse(src, { uniqueKeys: false })` accepts it.
- **`X38W`** — the same rule, reached the other way: a mapping keyed once by a
  sequence and once by an alias pointing at that sequence. Both keys render
  `[ a, b ]`, so the two pairs collapse into one in any JavaScript object, and
  reporting the collision beats dropping a value in silence. `uniqueKeys: false`
  accepts it.
- **`565N` / `2XXW` / `J7PZ`** — `!!binary` projects to a `Uint8Array`, `!!set` to a
  `Set`, `!!omap` to a `Map`, all three matching `yaml` (eemeli), where the suite
  expects the plain string or object those serialize to.

### Where this differs from `yaml` and `js-yaml`

The suite settles conformance; it does not settle the handful of documents where
the three parsers simply answer differently. These are the ones that exist, found
by fuzzing all three against each other over ~90k generated documents plus the
full suite corpus. Everything not listed here agrees.

| document | @amritk/yaml | `yaml` | `js-yaml` |
| --- | --- | --- | --- |
| `t: !!float 1` | `1` | `"1"` | `1` |
| `t: !!null x` | `null` | `"x"` | throws |
| `...` alone, or after a comment | no document | one `null` document | one `null` document |
| `%YAML 1.2` with no document | `UNEXPECTED_DIRECTIVE` | accepted | throws |
| `%YAML 1.2` twice | `DUPLICATE_DIRECTIVE` | accepted | throws |
| `? [a, b]` / `: v` | key `[ a, b ]` | key `[ a, b ]` | key `a,b` |

Reading them:

- **`!!float 1`** — the core schema's float production accepts an integer form, so
  `1` is a valid float and resolves to the number. `yaml` requires a decimal point
  and falls back to the raw string; `js-yaml` agrees with us.
- **`!!null x`** — a core tag coerces (see the Tags list under
  [Supported](#supported)), so the tag wins and the value is `null`. The three
  parsers pick three different answers here; ours is the one consistent with how
  `!!int "7"` and `!!bool "FALSE"` behave.
- **`...` with nothing before it** — the document-end marker ends a document; it
  does not open one. The suite's own event stream for these cases (`HWV9`, `QT73`,
  and the spec's Example 9.3, `M7A3`) is an empty stream, so the extra `null`
  document the other two emit is theirs, not ours.
- **The two `%YAML` cases** — the suite marks both as documents that *must* be
  rejected, which is why we report rather than accept.
- **Collection keys** — a JavaScript object needs a string key. We render the
  collection in flow style, matching `yaml`; `js-yaml` joins sequence items with a
  comma and renders a mapping key as `[object Object]`, which collapses distinct
  keys into one.

Two more differences are structural rather than per-document: problems are
**collected on `doc.errors`, never thrown** — so where `js-yaml` throws, we return
a document plus a diagnostic — and an alias to a collection projects to a **copy**
rather than a shared node (see [Not supported](#not-supported)).

---

## License

MIT
