/**
 * A forwarding shim, not an implementation.
 *
 * The validator, coercer and repairer engine now lives inside `@amritk/parsers`
 * as an internal module, so there is exactly one copy of it. This package stays
 * behind only while it is retired, re-exporting that engine so anything still
 * importing `@amritk/generate-validators` keeps getting the same functions.
 */
export { buildValidatorSchema, type GeneratedFile } from '@amritk/parsers/internal/validators'
