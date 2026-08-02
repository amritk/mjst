import { prepareValidator } from '@/interpreter/prepare'

import type { FromSchema, TypeDescribesEveryAcceptedValue } from './from-schema'
import type { Check, Guard, ValidateOptions } from './types'

/**
 * What {@link validateGuard} hands back when it infers the type from the schema:
 * a narrowing {@link Guard} whenever that narrowing is sound, and a non-narrowing
 * {@link Check} for the schemas where it would not be.
 *
 * The test is written `extends false` rather than `extends true` on purpose:
 * narrowing is the default, and it is given up only for a schema whose inferred
 * type is *demonstrably* partial. A schema whose type is not a literal — a plain
 * `JSONSchema` value handed over at runtime, say — cannot be judged either way
 * and keeps the predicate, exactly as before.
 */
type InferredGuard<S> = TypeDescribesEveryAcceptedValue<S> extends false ? Check<FromSchema<S>> : Guard<FromSchema<S>>

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
 * One family of schemas is the exception, and it is the honest kind: a schema
 * with no `type` (nor `enum` / `const` / `$ref`) carrying only object- or
 * array-shaped keywords — `{ properties: { a: { type: 'string' } } }`,
 * `{ required: ['a'] }`. JSON Schema has those keywords ignore an instance of the
 * wrong runtime type, so `42` passes, while the inferred type describes only the
 * object case. Narrowing there would be a silent lie at every call site, so those
 * get a non-narrowing {@link Check} — same verdict, no `input is`. Declare
 * `type: 'object'` and the predicate comes back; an explicit type argument is
 * always taken at face value.
 *
 * Options match {@link validate}'s, including {@link ValidateOptions.schemas} —
 * hand over documents you have already loaded, keyed by absolute URI, and a
 * `$ref` naming one of them resolves. Nothing here fetches or reads a file.
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
): [T] extends [never] ? InferredGuard<S> : Guard<T> => {
  return prepareValidator(schema, options, false) as unknown as [T] extends [never] ? InferredGuard<S> : Guard<T>
}
