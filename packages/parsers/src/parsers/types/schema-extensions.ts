import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Defines custom extension properties that can be added to specific schema
 * definitions during the build process.
 *
 * The outer key is the definition name (matching the $defs key in the root
 * schema, e.g., "parameter", "operation"). The inner key is the extension
 * property name (e.g., "x-enabled", "x-internal"). The value is a JSON
 * Schema that validates the extension property and generates its TypeScript type.
 *
 * Extensions are merged into the schema properties before type and parser
 * generation, so each extension gets full type safety and runtime validation.
 *
 * @example
 * ```typescript
 * const extensions: SchemaExtensions = {
 *   parameter: {
 *     'x-enabled': { type: 'boolean' },
 *     'x-internal': { type: 'boolean', default: false },
 *   },
 *   operation: {
 *     'x-codegen': {
 *       type: 'object',
 *       properties: {
 *         methodName: { type: 'string' },
 *       },
 *     },
 *   },
 * }
 *
 * const files = buildSchema(schema, 'Document', markdownDocumentation, extensions)
 * ```
 */
export type SchemaExtensions = Record<string, Record<string, JSONSchema>>
