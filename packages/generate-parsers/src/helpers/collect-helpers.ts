/** A more foolproof way to generate imports from the parserFunction */
export const collectHelpers = (parserFunction: string): string[] => {
  /** Collection of imports */
  const imports: string[] = []

  /** Find all validateArray imports */
  if (parserFunction.includes('validateArray')) {
    imports.push("import { validateArray } from './validators/validate-array';")
  }

  /** Find all validateRecord imports */
  if (parserFunction.includes('validateRecord')) {
    imports.push("import { validateRecord } from './validators/validate-record';")
  }

  /** Find all isObject imports */
  if (parserFunction.includes('isObject')) {
    imports.push("import { isObject } from 'mjst-helpers/is-object';")
  }

  return imports
}
