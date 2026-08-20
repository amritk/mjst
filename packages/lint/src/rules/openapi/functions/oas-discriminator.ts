import type { IFunctionResult, RulesetFunction } from '../../../core/types'
import { isObject } from './helpers'

/** Validates a v2 discriminator references a required property. */
export const oasDiscriminator: RulesetFunction = (schema, _options, context) => {
  if (!isObject(schema) || typeof schema['discriminator'] !== 'string') return []
  const property = schema['discriminator']
  const required = Array.isArray(schema['required']) ? schema['required'] : []
  const properties = isObject(schema['properties']) ? schema['properties'] : {}
  const results: IFunctionResult[] = []
  // `Object.hasOwn`, not `in`: the discriminator name comes from the document, so
  // `discriminator: constructor` matched `Object.prototype` and the missing
  // property went unreported.
  if (!Object.hasOwn(properties, property)) {
    results.push({
      message: `Discriminator "${property}" must be defined in properties`,
      path: [...context.path, 'discriminator'],
    })
  }
  if (!required.includes(property)) {
    results.push({
      message: `Discriminator "${property}" must be a required property`,
      path: [...context.path, 'discriminator'],
    })
  }
  return results
}
