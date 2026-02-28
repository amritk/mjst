import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { getDefaultValue } from '#parser/helpers/get-default-value'
import { getDiscriminatorValue } from '#parser/helpers/get-discriminator-value'
import { generateSchemaChecks } from '#parser/generators/generate-schema-checks'

/**
 * Generates a discriminated union validation expression.
 * Uses a discriminator property to efficiently choose the correct schema.
 */
export const generateDiscriminatedUnionValidation = (
  accessor: string,
  schemas: readonly JSONSchema[],
  discriminatorKey: string,
  defaultValue: string,
  isRequired: boolean,
): string => {
  const cases: string[] = []

  for (const schema of schemas) {
    const discriminatorValue = getDiscriminatorValue(schema, discriminatorKey)
    if (discriminatorValue !== null) {
      const schemaDefault = getDefaultValue(schema)
      const checks = generateSchemaChecks(accessor, schema)

      if (checks.length > 0) {
        // checks[0] is safe: we guard with checks.length > 0 above
        let combinedChecks = checks[0] as string
        for (let i = 1; i < checks.length; i++) {
          combinedChecks += ' && ' + checks[i]
        }
        cases.push(
          `${accessor}?.${discriminatorKey} === ${JSON.stringify(discriminatorValue)} && ${combinedChecks} ? ${accessor} : ${schemaDefault}`,
        )
      } else {
        cases.push(
          `${accessor}?.${discriminatorKey} === ${JSON.stringify(discriminatorValue)} ? ${accessor} : ${schemaDefault}`,
        )
      }
    }
  }

  if (cases.length === 0) {
    return isRequired ? `${accessor} ?? ${defaultValue}` : accessor
  }

  // Chain the cases together with ternary operators using a for loop instead of .reduce()
  // cases[0] is safe: we guard with cases.length === 0 above
  let result = cases[0] as string
  for (let i = 1; i < cases.length; i++) {
    result = cases[i] + ' : ' + result
  }
  return result
}
