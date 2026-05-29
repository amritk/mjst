import { prepareValidator } from '#interpreter/prepare'

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
 * the input. Provide the expected type argument to get the narrowing you want.
 *
 * @example
 * ```typescript
 * type User = { id: number; name: string }
 * const isUser = validateGuard<User>({
 *   type: 'object',
 *   properties: { id: { type: 'integer' }, name: { type: 'string' } },
 *   required: ['id', 'name'],
 * })
 *
 * if (isUser(input)) {
 *   input.name // narrowed to User
 * }
 * ```
 */
export const validateGuard = <T = unknown>(schema: unknown, options?: ValidateOptions): Guard<T> => {
  return prepareValidator(schema, options, false) as unknown as Guard<T>
}
