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
  /** Path to a markdown documentation file used to enrich generated comments. */
  readonly docs?: string
  /**
   * When true, compile the generated TypeScript files to .js and .d.ts output.
   * The .ts source files are removed after compilation.
   */
  readonly build?: boolean
  /**
   * When true, validate the schema and print any errors without generating files.
   * Exits with code 0 if valid, 1 if invalid.
   */
  readonly validate?: boolean
}
