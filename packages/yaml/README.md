<div align="center">

# @amritk/yaml

**A tiny, dependency-free YAML parser with exact source positions — built for diagnostics.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/badge/version-v0.0.0-6366f1?style=flat-square&logo=npm&logoColor=white)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![dependencies](https://img.shields.io/badge/dependencies-0-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe%20coded-100%25-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/yaml` parses YAML into a JavaScript value **and** a lightweight tree where **every node records the exact source it came from** — a `start` offset (inclusive) and an `end` offset (exclusive). That second part is the whole point: a linter or language server needs to put a squiggle at an exact `line:column`, and most fast YAML parsers throw position information away.

It is **zero-dependency** and tuned to be **small and fast**. Against the two parsers people reach for on the web:

- **vs [`yaml`](https://www.npmjs.com/package/yaml) (eemeli)** — the only other parser here that also tracks source positions — building the source-mapped tree is **~25–31× faster**, and the bundle is **~6× smaller**.
- **vs [`js-yaml`](https://www.npmjs.com/package/js-yaml)** — which has **no concept of source positions** — parsing straight to data is **~1.8–2× faster**, the bundle is **~2.3× smaller**, and we *also* hand you the positioned tree it cannot produce.

It targets the YAML that real configuration and OpenAPI documents use: block and flow collections, all three quoting styles, literal/folded block scalars with chomping, comments, anchors, aliases, merge keys, explicit `? key` / `: value` entries, and multi-document (`---`-separated) streams. Scalars resolve via the YAML 1.2 **core schema** — so an OpenAPI `version: 1.0.0` stays the string `"1.0.0"` instead of turning into a number — and the core-schema `!!` tags (`!!str`, `!!int`, `!!float`, `!!bool`, `!!null`) coerce a value when written. The common extended tags resolve too, matching `yaml` (eemeli): `!!binary` → `Uint8Array`, `!!timestamp` → `Date`, `!!set` → `Set`, and `!!omap` → `Map`. These fire only on an *explicit* tag, so an untagged ISO date string still stays a string.

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
| small (155 B) | 416k ops/s | 16.8k ops/s | **24.8×** |
| medium (2 KB) | 35.9k ops/s | 1.3k ops/s | **27.4×** |
| large (100 KB) | 747 ops/s | 24.0 ops/s | **31.2×** |

**Parse to plain data** — all three can do this.

| fixture | @amritk/yaml | yaml | js-yaml | vs yaml | vs js-yaml |
| --- | --- | --- | --- | --- | --- |
| small | 262k | 14.3k | 147k | 18.3× | 1.78× |
| medium | 24.7k | 1.1k | 12.9k | 23.3× | 1.92× |
| large | 538 | 26.7 | 275 | 20.1× | 1.96× |

**Bundle size** (minified + gzipped):

| | size | |
| --- | --- | --- |
| **@amritk/yaml** | **6.0 KB** | — |
| yaml | 35.6 KB | 5.9× larger |
| js-yaml | 13.5 KB | 2.3× larger |

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
- Multi-line plain scalars (folded) in block context.

**Type resolution (YAML 1.2 core schema)**

- `null` (`null`/`Null`/`NULL`/`~`/empty), booleans (`true`/`false` and case variants), integers (decimal, `0x` hex, `0o` octal), floats (including `.inf`/`-.inf`/`.nan`); everything else is a string. So `version: 1.0.0` stays the string `"1.0.0"`.

**Tags**

- Core scalar tags: `!!str`, `!!int`, `!!float`, `!!bool`, `!!null`.
- Extended tags: `!!binary` → `Uint8Array`, `!!timestamp` → `Date`, `!!set` → `Set`, `!!omap` → `Map` (matching `yaml`).
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
- **Multi-line plain scalars inside flow collections.** A plain scalar that *wraps across lines* within `[ … ]` / `{ … }` is not folded (the collection itself may still span lines at token boundaries).
- **Reserved indicators.** A plain scalar beginning with the reserved `@` or `` ` `` is accepted as text rather than rejected.

If you need full YAML 1.2 conformance, use [`yaml`](https://www.npmjs.com/package/yaml). If you need a small, fast, position-aware parser for diagnostics, use this.

---

## License

MIT
