/**
 * A forwarding shim, not an implementation.
 *
 * The parser and type engine now lives inside `@amritk/parsers` as an internal
 * module, so there is exactly one copy of it. This package stays behind only
 * while it is retired, re-exporting that engine so anything still importing
 * `@amritk/generate-parsers` keeps getting the same functions.
 */
export { buildSchema, type GeneratedFile, type ImportExtension } from '@amritk/parsers/internal/parsers'
