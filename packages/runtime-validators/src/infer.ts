import type { Check, Guard, Validator } from './types'

/**
 * Recovers the output type from a built {@link Guard}, {@link Check} or
 * {@link Validator}.
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
 *
 * A non-narrowing {@link Check} still carries its inferred type, so a schema that
 * gave up the `input is` claim (see {@link validateGuard}) can still be named.
 * {@link Guard} is tested first because it also satisfies `Check`'s call shape.
 */
export type Infer<V> =
  V extends Guard<infer T> ? T : V extends Validator<infer T> ? T : V extends Check<infer T> ? T : never
