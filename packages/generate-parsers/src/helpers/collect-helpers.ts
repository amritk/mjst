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

  /** Find all isObject imports */
  if (parserFunction.includes('isObject')) {
    imports.push("import { isObject } from '@amritk/helpers/is-object';")
  }

  /** Find all hasRef imports */
  if (parserFunction.includes('hasRef(')) {
    imports.push("import { hasRef } from '@amritk/helpers/schema-guards';")
  }

  return imports
}
