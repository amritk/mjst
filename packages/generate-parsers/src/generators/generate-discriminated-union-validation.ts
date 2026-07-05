import { safeAccessor } from '@amritk/helpers/safe-accessor'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { getDiscriminatorValue } from '#helpers/get-discriminator-value'

import { generateSchemaChecks } from './generate-schema-checks'

/**
 * Generates a discriminated union validation expression.
 * Uses a discriminator property to efficiently choose the correct schema.
 *
 * The emitted expression is a single *nested* ternary in schema order — for
 * branches `dog`, `cat` it reads `disc === "dog" ? v : disc === "cat" ? v :
 * <fallback>`. Each branch tests its discriminant (plus any per-branch shape
 * checks) and, on a match, passes the value through; the innermost `else` is the
 * shared fallback taken when no discriminant matches. The previous
 * `cases[i] + ' : ' + result` folding spliced complete ternaries together
 * (`c1 ? v : d1 : c0 ? v : d0`), which is a parse error for >=2 branches and
 * also evaluated branches in reverse with the wrong per-case default.
 */
export const generateDiscriminatedUnionValidation = (
  accessor: string,
  schemas: readonly JSONSchema[],
  discriminatorKey: string,
  defaultValue: string,
  isRequired: boolean,
): string => {
  // A non-identifier discriminator key (e.g. `x-type`) must use bracket access;
  // `${accessor}?.${key}` would emit broken TS. `safeAccessor` picks dot vs
  // bracket notation and JSON.stringifies the literal so quotes-in-keys are safe.
  const discAccessor = safeAccessor(`${accessor}?`, discriminatorKey)

  // Each branch contributes its guard condition and the value to yield on a
  // match; the value is `accessor` because `generateSchemaChecks` has already
  // proven the branch's shape (no coercion happens here).
  const branches: string[] = []

  for (const schema of schemas) {
    const discriminatorValue = getDiscriminatorValue(schema, discriminatorKey)
    if (discriminatorValue === null) continue

    let condition = `${discAccessor} === ${JSON.stringify(discriminatorValue)}`
    const checks = generateSchemaChecks(accessor, schema)
    for (const check of checks) {
      condition += ' && ' + check
    }
    branches.push(condition)
  }

  if (branches.length === 0) {
    return isRequired ? `${accessor} ?? ${defaultValue}` : accessor
  }

  // When no discriminant matches, a required union coerces to the shared default;
  // an optional one keeps the raw value untouched.
  let result = isRequired ? defaultValue : accessor
  // Fold from the last branch inward so the final text lists branches in schema
  // order: `cond0 ? accessor : cond1 ? accessor : <fallback>`.
  for (let i = branches.length - 1; i >= 0; i--) {
    result = `${branches[i]} ? ${accessor} : ${result}`
  }
  return result
}
