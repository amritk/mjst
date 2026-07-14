import type { SourceFormat } from '@amritk/adapters/source-format'

/**
 * Configuration for the CLI tool.
 * These properties map 1:1 with CLI flags and config file keys.
 */
export type CliConfig = {
  /** Path to the schema to process — a JSON Schema file, or a JS/TS module when `input` is set. */
  readonly schema?: string
  /**
   * Path to a directory of JSON Schema files. When set, the CLI walks the directory
   * recursively, generates parsers for every `*.json` schema it finds, and mirrors the
   * directory layout under `outDir`. A single shared `_helpers/` directory is emitted at
   * the root of `outDir` (in embedded mode) and every nested parser imports from it.
   * Mutually exclusive with `schema`; when both are present `schemaDir` wins.
   */
  readonly schemaDir?: string
  /**
   * The source format of the schema. Defaults to `'json'` (a plain JSON Schema file).
   * Any other format loads `schema` as a module and converts it via the matching adapter.
   */
  readonly input?: SourceFormat
  /**
   * Which export of the schema module to use when `input` is not `'json'`.
   * Defaults to the default export, or the sole named export when there is exactly one.
   */
  readonly export?: string
  /** Output directory for generated TypeScript files. Mutually exclusive with `outFile`. */
  readonly outDir?: string
  /**
   * Output everything to a single TypeScript file instead of a directory of files.
   * Mutually exclusive with `outDir`. Currently supported only with `typesOnly`.
   */
  readonly outFile?: string
  /**
   * When true, only generate TypeScript type definitions without parser functions.
   * Useful when you only need the type shapes and do not need runtime validation.
   */
  readonly typesOnly?: boolean
  /**
   * When true, also emit validation functions alongside the parsers. For every
   * generated type `X` the CLI writes a `validateX` (returning a rich
   * `ValidationResult` with JSON-Pointer error paths) and an `isX` boolean type
   * guard. The files land in a `validators/` subdirectory of the output so they
   * never collide with the parser files, which share the same schema-derived
   * names. Works with both `schema` and `schemaDir`. Incompatible with
   * `typesOnly` and `outFile`, which produce no runtime code.
   */
  readonly validators?: boolean
  /**
   * When true, also emit test-data files for every schema: a `fast-check`
   * arbitrary (`FooArbitrary`) that produces schema-valid values and a concrete
   * `fooExample` value. The files are written into an `examples/` subdirectory of
   * the output destination (mirroring the schema layout under `--schema-dir`) so
   * they never collide with the parser output. The generated arbitraries import
   * `fast-check`, which consumers must install as a (dev) dependency.
   */
  readonly examples?: boolean
  /**
   * When true, compile the generated TypeScript files to .js and .d.ts output.
   * The .ts source files are removed after compilation.
   */
  readonly build?: boolean
  /**
   * When true, the generated parsers emit a console.warn for every input key
   * that is not declared in the schema's properties.
   */
  readonly logWarnings?: boolean
  /**
   * When true, the generated parsers throw on type/shape mismatches
   * (wrong type, missing required property, enum/pattern/min/max violations)
   * instead of coercing invalid input to default values.
   */
  readonly strict?: boolean
  /**
   * When true, generated parsers build their result from declared properties
   * only, silently dropping any undeclared input key at every nesting level
   * (zod's `.strip()`). Extras are never a validation error, so this composes
   * with `strict` (which still throws on wrong types and missing required
   * properties) and yields to `additionalProperties: false`, which rejects
   * rather than strips in strict mode.
   */
  readonly stripUnknown?: boolean
  /**
   * When true, the generated coercing parsers normalize a mis-cased string to
   * the exact casing of a declared `enum`/`const` member it matches
   * case-insensitively (e.g. `hElLo` → `hello`) instead of coercing to the
   * default. Coerce mode only — `strict` parsers still reject a casing
   * mismatch. Correctly-cased input keeps the exact-match fast path, so the hot
   * path is unaffected.
   */
  readonly caseInsensitive?: boolean
  /**
   * Controls how generated parsers reference their runtime helpers.
   * - `'package'`: emit `import ... from '@amritk/helpers/...'`.
   * - `'embedded'`: ship the helper source under `outDir/_helpers/` and emit
   *   relative imports so the output directory is self-contained.
   *
   * When omitted, the CLI auto-detects: it picks `'package'` if `@amritk/helpers`
   * resolves from outDir, otherwise falls back to `'embedded'`.
   */
  readonly helpers?: 'package' | 'embedded'
  /**
   * When true, every property, array, and record in the generated type
   * definitions is emitted as `readonly`, producing deeply immutable types.
   */
  readonly readonly?: boolean
  /**
   * Suffix appended to every generated type name derived from a `$ref`
   * (e.g. `'Object'` turns `Contact` into `ContactObject`). Defaults to `''`
   * (no suffix). The root type name is used verbatim and is unaffected.
   */
  readonly typeSuffix?: string
  /**
   * Prepends a comment header to every generated file (excluding `_helpers/`).
   * - `true` — use the default message: "This file was auto-generated by @amritk/mjst…"
   * - A string — use that text as the message body (wrapped in a JSDoc block).
   * - `false` / omitted — no header.
   */
  readonly banner?: boolean | string
  /**
   * Extension emitted on every relative import specifier in the generated
   * output (cross-file `$ref` imports, the index barrel, and embedded-helper
   * imports).
   * - `'ts'` (default): the literal on-disk paths, so the generated `.ts`
   *   sources load under Bun, Node's type stripping (Node 22.6+ with
   *   `--experimental-strip-types`, unflagged from 22.18/23), and tsc with
   *   `allowImportingTsExtensions`. Incompatible with `build` — tsc refuses
   *   to emit from `.ts` specifiers.
   * - `'js'`: the standard TS NodeNext form (`./x.js` resolving to a sibling
   *   `x.ts`), for output that will be compiled. Used automatically when
   *   `build` is set and no extension was chosen explicitly.
   */
  readonly importExt?: 'js' | 'ts'
  /**
   * Name for the root type of a single-`schema` run (e.g. `'Program'` yields
   * `parseProgram` / `validateProgramShape`). When omitted, the name is
   * derived from the schema's `title`, falling back to the schema filename in
   * PascalCase (`spec-plan.json` → `SpecPlan`) and then to `'Document'`.
   * Not supported with `schemaDir`, where each schema names its own root.
   */
  readonly rootType?: string
}
