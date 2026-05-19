/** A more foolproof way to generate imports from the parserFunction */
export const collectHelpers = (parserFunction: string): string[] => {
  /** Collection of imports */
  const imports: string[] = []

  /** Find all validateArray imports */
  if (parserFunction.includes('validateArray')) {
    imports.push("import { validateArray } from '@amritk/helpers/validate-array';")
  }

  /** Find all validateRecord imports */
  if (parserFunction.includes('validateRecord')) {
    imports.push("import { validateRecord } from '@amritk/helpers/validate-record';")
  }

  // Inline isObject so generated output does not depend on @amritk/helpers at runtime.
  if (parserFunction.includes('isObject')) {
    imports.push(
      "const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);",
    )
  }

  /** Find all hasRef imports */
  if (parserFunction.includes('hasRef(')) {
    imports.push("import { hasRef } from '@amritk/helpers/schema-guards';")
  }

  return imports
}
