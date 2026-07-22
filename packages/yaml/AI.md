# @amritk/yaml — notes for AI coding agents

A fast, zero-dependency YAML parser for OpenAPI tooling that records exact
`[start, end)` source offsets on every node. Full reference is
[README.md](./README.md).

> Pre-alpha: APIs change in **minor** versions. This is a YAML **subset** for
> tooling, not full YAML 1.2 conformance.

## Minimal example

```ts
import { parseDocument, nodeAtPath, lineCounter } from '@amritk/yaml'

const source = 'info:\n  title: My API\n  version: 1.0.0\n'
const doc = parseDocument(source)

const node = nodeAtPath(doc.contents, ['info', 'version'])
const lc = lineCounter(source)
lc.linePos(node!.start) // → { line: 3, col: 12 } (1-based)

for (const error of doc.errors) {
  const { line, col } = lc.linePos(error.start)
  console.error(`${line}:${col} ${error.message}`)
}
```

## Gotchas — where agents fail

1. **`version: 1.0.0` stays the STRING `"1.0.0"`** (YAML 1.2 core schema), not a
   number — intentional for OpenAPI round-trip safety.
2. **Nodes carry `start` / `end` inline** (not a `range` tuple). `end` is
   **exclusive**, and offsets are char offsets — convert with `lineCounter`
   (1-based line/col).
3. **`parseDocument` reads only the FIRST document** of a `---` stream. Use
   `parseAllDocuments` for multi-doc; each doc has its own anchor scope.
4. **Values materialize lazily via `toJS()`** (resolves aliases + merge keys);
   `parse()` === `parseDocument().toJS()`. `pair.value` can be `null` (e.g.
   `paths:` with no value).
5. **Errors are collected on `doc.errors` / `doc.warnings`, not thrown.** Tab
   indentation is a `TAB_INDENT` error.

Exports: `parse`, `parseDocument`, `parseAllDocuments`, `nodeAtPath`,
`lineCounter`, the guards `isScalar`/`isMap`/`isSeq`/`isPair`/`isAlias`, + node
types. Only the `.` entry. Install: `bun add @amritk/yaml`.
