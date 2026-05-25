# Plan: Schema Adapters (Zod, TypeBox, …)

## Goal

Let users feed schemas authored in other libraries — Zod, TypeBox, Valibot,
Effect Schema — into mjst, instead of only hand-written JSON Schema files.

## Key insight

The whole generation pipeline is already JSON-Schema-centric. `buildSchema()`
(`packages/generate-parsers/src/generators/build-schema.ts`) takes a
`JSONSchema` (Draft 2020-12) and everything downstream operates on that. The
**only** place that assumes JSON-on-disk is the CLI, which does `readFile` +
`JSON.parse` (`packages/cli/src/cli.ts:58-60`).

So an adapter is a thin "source schema → JSON Schema 2020-12" converter that
runs *before* `buildSchema`. The core generators stay untouched. Most target
libraries already emit JSON Schema, so adapters are wrappers, not
reimplementations:

| Source     | Conversion mechanism                          | Effort |
|:-----------|:----------------------------------------------|:-------|
| TypeBox    | schemas *are* JSON Schema objects (pass-through + draft normalize) | lowest |
| Zod        | Zod 4 `z.toJSONSchema()`; Zod 3 `zod-to-json-schema` | low |
| Valibot    | `@valibot/to-json-schema`                     | low |
| Effect     | `JSONSchema.make`                             | low |

## The real work: input loading, not conversion

A `.json` schema is trivial to read. A Zod/TypeBox schema lives in a `.ts`/`.js`
**module** that *exports a value*, so the CLI must import and execute user code
and select which export is the schema. This is the part that needs design:

- Loading a `.ts` module on the fly (consumer may be running under Node, not Bun).
- Choosing the exported symbol (default export vs named — needs a convention/flag).
- Keeping `zod` / `typebox` as **optional** peer deps so the core CLI stays slim.

## Proposed shape

### 1. Adapter interface (`@amritk/generate-parsers` or a new `@amritk/adapters`)

```ts
// SourceFormat is the user-facing name; 'json' is the existing default.
export type SourceFormat = 'json' | 'typebox' | 'zod' | 'valibot' | 'effect'

export type Adapter = {
  readonly format: SourceFormat
  /** Convert a loaded source schema value into a Draft 2020-12 JSON Schema. */
  toJSONSchema(source: unknown): JSONSchema | Promise<JSONSchema>
}
```

Each adapter is one function per file, matching the repo's FP convention
(`.claude/typescript.md`, `architecture.md` design principles).

### 2. Ship adapters as separate packages (recommended)

`@amritk/adapter-typebox`, `@amritk/adapter-zod`, etc. Each declares its target
library as an **optional peer dependency**. The CLI dynamically `import()`s the
adapter package only when the matching `--input` format is requested, so users
who only use JSON pull in nothing extra.

Alternative (simpler v1): put all adapters in one `@amritk/adapters` package
with the source libs as optional peers. Easier to start, slightly heavier.
**Recommendation:** start with one package, split later if dep weight matters.

### 3. CLI wiring

- Add `input` to `CliConfig` (`packages/cli/src/cli-config.ts`):
  `readonly input?: SourceFormat` (default `'json'`).
- Add `--input <format>` parsing in `parse-cli-args.ts` (mirror the existing
  `--helpers` enum-validation pattern) and `loadConfig` in `load-config.ts`.
- In `cli.ts`, branch on `config.input`:
  - `'json'` → current `readFile` + `JSON.parse` path (unchanged).
  - otherwise → import the schema module, run the adapter's `toJSONSchema`,
    then hand the result to the **existing** `buildSchema` call unchanged.
- Add a `--export <name>` flag (default: `default`, fallback to a sole named
  export) to pick which symbol from the module is the schema.
- Document the new keys in `packages/cli/config.schema.json` with `x-cli-flag`
  / `x-icon` so `@amritk/generate-markdown` regenerates the README table.

### 4. Module loading strategy

- Use dynamic `import()` of the resolved absolute path.
- For `.ts` inputs under plain Node, document requiring a loader (e.g.
  `tsx`/`ts-node`) or running via `bunx`. Investigate whether to auto-register
  `tsx` when present. (Open question — see below.)

## Testing

Per `.claude/testing.md` (Vitest, colocated `*.test.ts`, minimal mocking):

- Unit-test each adapter: a representative source schema in → expected JSON
  Schema out (objects, arrays, enums, optional/required, nested refs).
- Round-trip test: source schema → adapter → `buildSchema` → assert generated
  types/parsers match the equivalent hand-written JSON Schema fixture.
- CLI test: `--input typebox` against a fixture module produces expected files.

## Rollout order

1. **TypeBox adapter** — lowest effort (near pass-through); proves the
   interface + CLI wiring end to end.
2. **Zod adapter** — highest user demand; handle Zod 3 vs 4 conversion paths.
3. **Valibot / Effect** — same interface, additive.

## Lossy constructs → `x-mjst` extension (resolves open question #4)

Some source constructs have no native JSON Schema 2020-12 keyword — e.g.
TypeBox's `Type.Date()` (a runtime `Date`, not a JSON value). Rather than warn
and drop these, adapters **preserve them as an `x-mjst` vendor extension** and
the generators are taught to handle it, so types and runtime behaviour stay
correct end to end.

### The keyword

```jsonc
// A field that must be a runtime Date at validation time:
{ "x-mjst": { "instanceOf": "Date" } }
```

`x-mjst` is a namespaced object holding mjst-only hints. The first field is
`instanceOf`: the name of a JavaScript class the value must be an instance of.
The class name is validated against an identifier pattern so it can never inject
code into generated output. No native `type` is emitted, so existing
type-keyed code paths do not fire on these nodes.

Shared contract lives in `@amritk/helpers/mjst-extension`
(`MJST_EXTENSION_KEY`, `MjstExtension`, `getMjstInstanceOf`) so adapters write
it and generators read it from one source of truth.

### How each generator handles it

- **Types** (`@amritk/helpers/generate-type-definition`): emit the class name
  directly (`Date`).
- **Parsers** (`generate-parsers`): validity is `value instanceof Date`; in
  non-strict mode invalid values are coerced when a coercer is known
  (`Date` → `new Date(value)`), otherwise fall back to the default. Strict mode
  throws on a non-instance.
- **Validators** (`generate-validators`): emit an `instanceof` check with a
  `must be <Class>` error.

### Adapter responsibility

TypeBox emits non-standard `type` strings for its extended types (e.g.
`type: 'Date'`). The TypeBox adapter maps a known set of these to an
`instanceOf` extension (starting with `Date`). Unrecognised non-standard types
still warn and pass through, preserving the permissive fallback.

## Open questions

- `.ts` module loading under plain Node — require a loader, or auto-register
  `tsx`? Affects DX significantly.
- Export selection convention — default export, single named export, or always
  require `--export`?
- One `@amritk/adapters` package vs one package per library.
