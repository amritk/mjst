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
3. **`parseDocument` reads only the FIRST document** of a `---` stream, and
   pushes a `MULTIPLE_DOCUMENTS` **warning** when it leaves one behind. Use
   `parseAllDocuments` for multi-doc; each doc has its own anchor scope.
4. **Values materialize lazily via `toJS()`** (resolves aliases + merge keys);
   `parse()` === `parseDocument().toJS()`. `pair.value` can be `null` (e.g.
   `paths:` with no value).
5. **Errors are collected on `doc.errors` / `doc.warnings`, not thrown.** Codes
   include `DUPLICATE_KEY`, `UNRESOLVED_ALIAS`, `UNEXPECTED_CONTENT`,
   `UNTERMINATED_FLOW`, `TAB_INDENT`, `UNEXPECTED_DIRECTIVE`, and the
   syntax-level `BAD_COMMENT` / `BAD_ESCAPE` / `BAD_BLOCK_HEADER` /
   `BAD_INDENT` / `BAD_IMPLICIT_KEY` / `BAD_PROPERTY` /
   `BAD_SCALAR_CONTENT` (a `: ` inside a plain scalar). A misplaced or malformed
   directive is an **error**; an unknown directive, a non-1.2 `%YAML` version,
   and `MULTIPLE_DOCUMENTS` are warnings. A document with errors still parses —
   check `doc.errors` rather than assuming a throw.
6. **`node.tag` keeps a local tag's `!`.** `!!str` → `'str'`, `!custom` →
   `'!custom'`. Only the core/extended schema tags coerce a value; a local tag
   passes it through. `!<verbatim>` and `%TAG` handles resolve to the same form.
7. **A collection mapping key projects to its flow rendering.** `[a, b]: v`
   becomes `{ '[ a, b ]': 'v' }`, and an empty key becomes `''` (not `'null'`),
   because a JS object key can only be a string. `keyText(node)` is exported so
   you can compute that string yourself — `nodeAtPath` matches path segments
   against it, so a path built any other way will not find the node.
8. **All three YAML line breaks work**: `\n`, `\r\n`, and a lone `\r`, in both
   the parser and `lineCounter`.
9. **Two aliases to one anchored collection project to two copies**, not one
   shared object (`b !== c` for `b: *x` / `c: *x`). Deliberate — `toJS()` is a
   plain tree, not an object graph.
10. **An anchor or tag on a mapping key describes the KEY.** `&a a: b` anchors
   the scalar `a`, so `*a` is `'a'` — not the mapping. Properties on a line of
   their own above the mapping describe the mapping.
11. **JSON parses as JSON.** YAML 1.2 is a strict superset, and this parser
   matches `JSON.parse` exactly — same value, zero diagnostics — for JSON in any
   spelling (compact, pretty, **tab-indented**, CRLF). Pinned by
   `src/json-superset.test.ts` over a generated corpus, so hand a `.json`
   document straight to `parse` rather than branching on the extension.
12. **A tab is only an error where indentation belongs.** `TAB_INDENT` fires on a
   tab whose column falls inside the indentation a line owes its context — so
   `\t[a]` at the root and `foo:` over `⟨space⟩⟨tab⟩bar` are fine, `\tb:` under
   an `a:` is not. Don't assume a leading tab always reports.

Exports: `parse`, `parseDocument`, `parseAllDocuments`, `nodeAtPath`,
`lineCounter`, `keyText`, the guards
`isScalar`/`isMap`/`isSeq`/`isPair`/`isAlias`, + node types. Only the `.` entry.
Install: `bun add @amritk/yaml`.
