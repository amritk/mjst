import { prepareValidator } from '@/interpreter/prepare'

import type { FromSchema } from './from-schema'
import type { Guard, ValidateOptions } from './types'

/**
 * Builds the fastest kind of validator: a boolean type guard.
 *
 * The guard short-circuits on the first failing check and never allocates an
 * error object or builds a path string, so it is the hot-path tool for things
 * like request filtering, cache admission, or any tight loop where you only
 * care whether the value matches. When you need to know *why* something failed,
 * use {@link validate} instead.
 *
 * The result is typed as a TypeScript type guard so a successful check narrows
 * the input. By default the guard type is inferred from the schema (written
 * `as const`, or via this function's `const` inference), so you do not have to
 * spell it out. You can still pass an explicit type argument to override it.
 *
 * @example
 * ```typescript
 * const isUser = validateGuard({
 *   type: 'object',
 *   properties: { id: { type: 'integer' }, name: { type: 'string' } },
 *   required: ['id', 'name'],
 * })
 *
 * if (isUser(input)) {
 *   input.name // narrowed to { id: number; name: string }
 * }
 * ```
 */
export const validateGuard = <T = never, const S = unknown>(
  schema: S,
  options?: ValidateOptions,
): Guard<[T] extends [never] ? FromSchema<S> : T> => {
  return prepareValidator(schema, options, false) as unknown as Guard<[T] extends [never] ? FromSchema<S> : T>
}
