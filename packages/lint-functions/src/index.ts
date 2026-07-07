import type { FunctionRegistry } from '@amritk/lint-core'

import { alphabetical } from './alphabetical'
import { casing } from './casing'
import { defined } from './defined'
import { enumeration } from './enumeration'
import { falsy } from './falsy'
import { length } from './length'
import { pattern } from './pattern'
import { schema } from './schema'
import { truthy } from './truthy'
import { typedEnum } from './typed-enum'
import { undefinedFn } from './undefined'
import { unreferencedReusableObject } from './unreferenced-reusable-object'
import { xor } from './xor'

export { alphabetical, type IAlphabeticalOptions } from './alphabetical'
export { type CasingType, casing, type ICasingOptions } from './casing'
export { defined } from './defined'
export { enumeration } from './enumeration'
export { falsy } from './falsy'
export { length } from './length'
export { pattern } from './pattern'
export { type ISchemaOptions, schema } from './schema'
export { truthy } from './truthy'
export { typedEnum } from './typed-enum'
export { undefinedFn } from './undefined'
export { type IUnreferencedReusableObjectOptions, unreferencedReusableObject } from './unreferenced-reusable-object'
export { type IXorOptions, xor } from './xor'

/** All built-in functions, keyed by their Linter-compatible names. */
export const builtinFunctions: FunctionRegistry = {
  alphabetical: alphabetical as FunctionRegistry[string],
  casing: casing as FunctionRegistry[string],
  defined,
  enumeration: enumeration as FunctionRegistry[string],
  falsy,
  length: length as FunctionRegistry[string],
  pattern: pattern as FunctionRegistry[string],
  schema: schema as FunctionRegistry[string],
  truthy,
  undefined: undefinedFn,
  unreferencedReusableObject: unreferencedReusableObject as FunctionRegistry[string],
  xor: xor as FunctionRegistry[string],
  typedEnum: typedEnum as FunctionRegistry[string],
}
