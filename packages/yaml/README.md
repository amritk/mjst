<div align="center">

# @amritk/yaml

**The featherweight YAML parser built for OpenAPI tooling — fast, zero-dependency, and it never loses track of where a value came from, down to the column.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/badge/version-v0.0.0-6366f1?style=flat-square&logo=npm&logoColor=white)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![dependencies](https://img.shields.io/badge/dependencies-0-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/yaml` parses YAML into a JavaScript value **and** a lightweight tree where **every node records the exact source it came from** — a `start` offset (inclusive) and an `end` offset (exclusive). That second part is the whole point: a linter or language server needs to put a squiggle at an exact `line:column`, and most fast YAML parsers throw position information away.

It is **zero-dependency** and tuned to be **small and fast**. Against the two parsers people reach for on the web:

- **vs [`yaml`](https://www.npmjs.com/package/yaml) (eemeli)** — the only other parser here that also tracks source positions — building the source-mapped tree is **~25–31× faster**, and the bundle is **~6× smaller**.
- **vs [`js-yaml`](https://www.npmjs.com/package/js-yaml)** — which has **no concept of source positions** — parsing straight to data is **~1.8–2× faster**, the bundle is **~2.3× smaller**, and we *also* hand you the positioned tree it cannot produce.

It targets the YAML that real configuration and OpenAPI documents use: block and flow collections, all three quoting styles, literal/folded block scalars with chomping, comments, anchors, aliases, merge keys, explicit `? key` / `: value` entries, and multi-document (`---`-separated) streams. Scalars resolve via the YAML 1.2 **core schema** — so an OpenAPI `version: 1.0.0` stays the string `"1.0.0"` instead of turning into a number — and the core-schema `!!` tags (`!!str`, `!!int`, `!!float`, `!!bool`, `!!null`) coerce a value when written.

**OpenAPI compatibility.** OpenAPI restricts its YAML to the JSON-compatible subset — *"tags MUST be limited to those allowed by the JSON Schema ruleset"* and map keys must be scalar strings — and that subset is exactly what's covered above. Keeping `version: 1.0.0` a string (rather than a float) and *not* coercing untagged ISO dates into `Date`s is the correct, round-trip-safe behavior an OpenAPI tool needs.

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

Each document gets its own `contents`, `errors`, `warnings`, and anchor scope (an alias in one document does not resolve an anchor declared in another). `parseDocument` reads only the first document of a stream.

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
| `isScalar` / `isMap` / `isSeq` / `isPair` / `isAlias` | Narrowing guards over the node union. |

**Options**

- `uniqueKeys` (default `true`) — report duplicate mapping keys as errors. Set `false` to allow them (last value wins).
- `merge` (default `true`) — honor the `<<` merge key. Set `false` to treat `<<` as an ordinary key.

---

## Performance

Run it yourself with `bun run bench`. Representative numbers (Bun, Linux):

**Parse to a source-mapped tree** — the job this package exists for. `js-yaml` cannot produce positions, so it is not a candidate here.

| fixture | @amritk/yaml | yaml (eemeli) | speedup |
| --- | --- | --- | --- |
| small (155 B) | 297k ops/s | 11.4k ops/s | **25.9×** |
| medium (2 KB) | 27.7k ops/s | 918 ops/s | **30.2×** |
| large (100 KB) | 529 ops/s | 21.1 ops/s | **25.1×** |

**Parse to plain data** — all three can do this.

| fixture | @amritk/yaml | yaml | js-yaml | vs yaml | vs js-yaml |
| --- | --- | --- | --- | --- | --- |
| small | 238k | 12.0k | 115k | 19.8× | 2.08× |
| medium | 20.0k | 918 | 10.1k | 21.8× | 1.99× |
| large | 315 | 18.5 | 218 | 17.0× | 1.44× |

**Bundle size** (minified + gzipped):

| | size | |
| --- | --- | --- |
| **@amritk/yaml** | **6.6 KB** | — |
| yaml | 35.6 KB | 5.4× larger |
| js-yaml | 13.5 KB | 2.0× larger |

Correctness is pinned to `yaml` by a differential test suite (`src/differential.test.ts`) that parses a battery of documents — including full OpenAPI specs — and asserts byte-identical data output. Where `js-yaml` diverges (its `!!timestamp` type turns ISO strings into `Date`s, which is wrong for a JSON superset), we instead agree with `yaml`.

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
- Explicit `? key` / `: value` entries, including block and complex (map/seq) keys.

**Scalars**

- Plain (unquoted), single-quoted (`''` escape), and double-quoted scalars (full escapes — `\n`, `\t`, `\xNN`, `\uNNNN`, `\UNNNNNNNN` — line continuation, and folding).
- Literal `|` and folded `>` block scalars with chomping (`-` strip, `+` keep, default clip) and explicit indentation indicators.
- Multi-line plain scalars (folded) in both block context and flow context (`[ … ]` / `{ … }`), where a wrapped line's indentation is trimmed and line breaks fold per YAML 1.2 (single break → space, a run of *n* breaks → *n − 1* newlines).

**Type resolution (YAML 1.2 core schema)**

- `null` (`null`/`Null`/`NULL`/`~`/empty), booleans (`true`/`false` and case variants), integers (decimal, `0x` hex, `0o` octal), floats (including `.inf`/`-.inf`/`.nan`); everything else is a string. So `version: 1.0.0` stays the string `"1.0.0"`.

**Tags**

- Core scalar tags (the JSON-compatible set OpenAPI allows): `!!str`, `!!int`, `!!float`, `!!bool`, `!!null`.
- Extended tags, for general config files beyond the OpenAPI subset: `!!binary` → `Uint8Array`, `!!timestamp` → `Date`, `!!set` → `Set`, `!!omap` → `Map` (matching `yaml`). A conformant OpenAPI document won't use these.
- Any other tag is **captured on the node** (readable via `node.tag`) and its value passed through unchanged.

**References, documents, and trivia**

- Anchors (`&name`) and aliases (`*name`); `<<` merge keys (toggle with the `merge` option).
- Multi-document streams (`---` / `...`) via `parseAllDocuments`, each document with its own anchor scope and problem list.
- Comments (full-line and inline), blank lines, and a leading byte-order mark.

**Diagnostics**

- Exact `[start, end)` source span on every node, duplicate-key detection (`DUPLICATE_KEY`), unterminated flow collections (`UNTERMINATED_FLOW`), and tab-in-indentation (`TAB_INDENT`).

### Not supported

- **Tab indentation.** Forbidden by YAML 1.2; reported as a `TAB_INDENT` error rather than parsed. (Tabs *after* content — e.g. separating a key from its value — are fine.)
- **Directive processing.** `%YAML` and `%TAG` lines are skipped, not applied. There is no resolution of named tag handles (`!handle!suffix`) or verbatim tags (`!<uri>`); every `!`/`!!` prefix is stripped and only the core/extended tag names above are interpreted, so a local `!foo` and `!!foo` are treated alike.
- **Schema selection.** Always the 1.2 core schema — no JSON, failsafe, or YAML 1.1 schema switch.
- **YAML 1.1-only scalar forms.** `yes`/`no`/`on`/`off` booleans, sexagesimal numbers (`1:30:00`), and underscore digit groups (`1_000`) stay strings, per the 1.2 core schema.
- **Implicit timestamps.** An untagged ISO date string stays a string; only an explicit `!!timestamp` produces a `Date`.
- **Reserved indicators.** A plain scalar beginning with the reserved `@` or `` ` `` is accepted as text rather than rejected.

If you need full YAML 1.2 conformance, use [`yaml`](https://www.npmjs.com/package/yaml). If you need a small, fast, position-aware parser for diagnostics, use this.

---

## License

MIT
