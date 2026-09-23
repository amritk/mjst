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
5. **Errors are collected on `doc.errors` / `doc.warnings`, not thrown.**
   `error.code` is typed as the exported `YamlErrorCode` union, so a typo in a
   comparison fails to typecheck. **Errors:** `DUPLICATE_KEY`,
   `UNRESOLVED_ALIAS`, `RECURSIVE_ALIAS`, `UNTERMINATED_FLOW`,
   `UNTERMINATED_QUOTE`, `UNEXPECTED_CONTENT`, `UNEXPECTED_COMMA`,
   `TAB_INDENT`, `BAD_SCALAR_START`, `BAD_SCALAR_CONTENT` (a `: ` inside a plain
   scalar), `BAD_COMMENT`, `BAD_ESCAPE`, `BAD_MERGE` (a `<<` value that is not a
   mapping or a list of them), `BAD_BLOCK_HEADER`, `BAD_INDENT`,
   `BAD_IMPLICIT_KEY`, `BAD_PROPERTY`, `BAD_ANCHOR`, `BAD_TAG`,
   `UNKNOWN_TAG_HANDLE`, `UNEXPECTED_DIRECTIVE`, `DEPTH_LIMIT`, and — for
   `%YAML` only — `BAD_DIRECTIVE` / `DUPLICATE_DIRECTIVE`. **Warnings:**
   `UNKNOWN_DIRECTIVE`, `UNSUPPORTED_YAML_VERSION` (a non-1.2 `%YAML`), a
   malformed or repeated `%TAG` (`BAD_DIRECTIVE` / `DUPLICATE_DIRECTIVE` again —
   **the same two codes can arrive as either kind**, so check `kind` too),
   `AMBIGUOUS_ANCHOR_NAME` (an anchor or alias name ending in `:` — YAML makes
   the `:` part of the name, so `*x: v` aliases `x:` and the mapping keeps no
   separator), `BAD_TAG_VALUE` (a `!!` tag that cannot describe its value, e.g.
   `!!int 1.9` — the value is kept as the string written), and
   `MULTIPLE_DOCUMENTS`. A document with errors still parses — check
   `doc.errors` rather than assuming a throw. Problems arrive in **source
   order**. The one exception to "never throws" is `toJS()` / `parse()` on a
   resource-exhaustion document — runaway alias expansion or nesting too deep to
   project — which raises a catchable `Error`; wrap the call for untrusted input.
6. **`node.tag` keeps a local tag's `!`.** `!!str` → `'str'`, `!custom` →
   `'!custom'`. Only the core/extended schema tags change a value, and only
   text written in the tag's own format: `!!int "7"` is `7`, but `!!int 1.9`
   stays the string `'1.9'` with a `BAD_TAG_VALUE` warning — never assume a tag
   forces a type. A local tag passes the value through. `!<verbatim>` and `%TAG`
   handles resolve to the same form. `!!timestamp` without a time zone is UTC.
7. **A collection mapping key projects to its flow rendering.** `[a, b]: v`
   becomes `{ '[ a, b ]': 'v' }`, and an empty key becomes `''` (not `'null'`),
   because a JS object key can only be a string. `keyText(node)` is exported so
   you can compute that string yourself — `nodeAtPath` matches path segments
   against it, so a path built any other way will not find the node. The
   rendering is **bounded**: a key whose aliases expand past a few thousand
   characters ends in `…` instead of running away, so two pathological keys can
   render alike (and get reported as duplicates). No key a document means is
   affected.
8. **All three YAML line breaks work**: `\n`, `\r\n`, and a lone `\r`, in both
   the parser and `lineCounter`.
9. **Two aliases to one anchored collection project to two copies**, not one
   shared object (`b !== c` for `b: *x` / `c: *x`). Deliberate — `toJS()` is a
   plain tree, not an object graph. `nodeAtPath` **follows an alias** on the way
   down, so a path under `required: *ref` resolves to the node inside the
   anchored value; a path that *ends* on the alias returns the alias node itself.
   A duplicated key resolves to the pair that won (the **last**), matching
   `toJS()`. Two paths return `undefined` even though the projection has a value
   there: a key with **no value** (`paths:` → `null`, no value node exists) and a
   key a `<<` **merge** brought in (not written at that path). Both fall back to
   the holding map with `closest: true`.
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
13. **Nothing is silently rewritten.** An invalid double-quoted escape
   (`"C:\Users"`) keeps its backslash in the value and reports `BAD_ESCAPE`. A
   mapping may repeat a plain `<<` merge key (`<<: *a` / `<<: *b`) without a
   `DUPLICATE_KEY` while `merge` is on; with `merge: false`, `<<` is an ordinary
   key and a repeat *is* a duplicate. `---` and `...` are document markers only
   at column 0 — indented, they are ordinary text.

Exports: `parse`, `parseDocument`, `parseAllDocuments`, `nodeAtPath`,
`lineCounter`, `keyText`, the guards
`isScalar`/`isMap`/`isSeq`/`isPair`/`isAlias`, + node types. Only the `.` entry.
Install: `bun add @amritk/yaml`.
