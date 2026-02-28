import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { generateSchemaChecks } from '#parser/generators/generate-schema-checks'

/**
 * Generates a non-discriminated union validation expression.
 * Tries each schema in order until one matches.
 */
export const generateNonDiscriminatedUnionValidation = (
  accessor: string,
  schemas: readonly JSONSchema[],
  defaultValue: string,
  isRequired: boolean,
): string => {
  const cases: string[] = []

  for (const schema of schemas) {
    const checks = generateSchemaChecks(accessor, schema)

    if (checks.length > 0) {
      let combinedChecks = checks[0]
      for (let i = 1; i < checks.length; i++) {
        combinedChecks += ' && ' + checks[i]
      }
      cases.push('(' + combinedChecks + ')')
    }
  }

  if (cases.length === 0) {
    return isRequired ? `${accessor} ?? ${defaultValue}` : accessor
  }

  // Try each schema in order
  let combinedCheck = cases[0]
  for (let i = 1; i < cases.length; i++) {
    combinedCheck += ' || ' + cases[i]
  }
  const finalDefault = isRequired ? defaultValue : 'undefined'
  return `(${combinedCheck}) ? ${accessor} : ${finalDefault}`
}
