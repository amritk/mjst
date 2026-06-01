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

- **vs [`yaml`](https://www.npmjs.com/package/yaml) (eemeli)** — the only other parser here that also tracks source positions — building the source-mapped tree is **~25–31× faster**, and the bundle is **~7.3× smaller**.
- **vs [`js-yaml`](https://www.npmjs.com/package/js-yaml)** — which has **no concept of source positions** — parsing straight to data is **~1.8–2× faster**, the bundle is **~2.8× smaller**, and we *also* hand you the positioned tree it cannot produce.

It targets the YAML that real configuration and OpenAPI documents use: block and flow collections, all three quoting styles, literal/folded block scalars with chomping, comments, anchors, aliases, and merge keys. Scalars resolve via the YAML 1.2 **core schema**, so an OpenAPI `version: 1.0.0` stays the string `"1.0.0"` instead of turning into a number.

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
| **@amritk/yaml** | **4.8 KB** | — |
| yaml | 35.6 KB | 7.3× larger |
| js-yaml | 13.5 KB | 2.8× larger |

Correctness is pinned to `yaml` by a differential test suite (`src/differential.test.ts`) that parses a battery of documents — including full OpenAPI specs — and asserts byte-identical data output. Where `js-yaml` diverges (its `!!timestamp` type turns ISO strings into `Date`s, which is wrong for a JSON superset), we instead agree with `yaml`.

---

## Scope

The parser covers the YAML that configuration and OpenAPI documents use in the wild, including explicit `? key` / `: value` mapping entries, multi-document streams (via `parseAllDocuments`), and the core-schema `!!` tags (`!!str`, `!!int`, `!!float`, `!!bool`, `!!null`) applied to scalar values. Custom/global tags beyond those hints are captured on the node but otherwise passed through unchanged, and non-space (tab) indentation is intentionally out of scope — it would cost a comparison on the hottest scanning loop and is forbidden by YAML 1.2 anyway. If you need full YAML 1.2 conformance, use `yaml`; if you need a small, fast, position-aware parser for diagnostics, use this.

---

## License

MIT
