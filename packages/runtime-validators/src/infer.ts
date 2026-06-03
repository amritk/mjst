import type { Guard, Validator } from './types'

/**
 * Recovers the output type from a built {@link Guard} or {@link Validator}.
 *
 * Both `validate` and `validateGuard` infer their output type from the schema you
 * pass, so this lets you name that type without repeating the schema:
 *
 * @example
 * ```typescript
 * const validateUser = validate({
 *   type: 'object',
 *   properties: { id: { type: 'integer' } },
 *   required: ['id'],
 * })
 *
 * type User = Infer<typeof validateUser>
 * //   ^? { id: number }
 * ```
 */
export type Infer<V> = V extends Guard<infer T> ? T : V extends Validator<infer T> ? T : never
