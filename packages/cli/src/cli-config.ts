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
   * When true, prepends a comment header to every generated file noting that
   * the file was produced by @amritk/mjst and should not be edited manually.
   * Runtime helper files (under `_helpers/`) are not annotated.
   */
  readonly banner?: boolean
}
