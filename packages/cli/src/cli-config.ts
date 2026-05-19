/**
 * Configuration for the CLI tool.
 * These properties map 1:1 with CLI flags and config file keys.
 */
export type CliConfig = {
  /** Path to the JSON Schema file to process. */
  readonly schema: string
  /** Output directory for generated TypeScript files. */
  readonly outDir: string
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
}
