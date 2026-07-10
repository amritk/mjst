import type { RulesetFunction } from '../../../core'
import { isObject } from './helpers'

/** Validates OpenAPI v2 formData operations declare a compatible `consumes`. */
export const oasOpFormDataConsumeCheck: RulesetFunction = (operation, _options, context) => {
  if (!isObject(operation)) return []
  const params = Array.isArray(operation['parameters']) ? operation['parameters'] : []
  const hasFormData = params.some((param) => isObject(param) && param['in'] === 'formData')
  if (!hasFormData) return []
  const consumes = Array.isArray(operation['consumes']) ? operation['consumes'] : []
  const ok = consumes.some((type) => type === 'application/x-www-form-urlencoded' || type === 'multipart/form-data')
  if (!ok) {
    return [
      {
        message:
          'Operations with formData parameters must consume application/x-www-form-urlencoded or multipart/form-data',
        path: [...context.path, 'consumes'],
      },
    ]
  }
  return []
}
