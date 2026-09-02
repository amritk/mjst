import { coerceScalar } from '@amritk/runtime-validators/parse'

/**
 * Converts a raw string parameter to the primitive its schema declares. When
 * the string does not actually represent that primitive, the original string
 * is returned unchanged — the validator then rejects it with a proper type
 * error instead of this function guessing (`Number('abc')` is `NaN`, which
 * `typeof`-checks as a number and would otherwise slip through).
 *
 * The rules themselves live in `@amritk/runtime-validators/parse`, which
 * applies the same table at every depth for a schema discovered at runtime.
 * They are shared rather than restated because this is precisely the kind of
 * small, subtle table that drifts: each of its guards — blank strings, the
 * non-finite `'Infinity'` — was added here after a bug, and a second copy would
 * have to learn each one again.
 *
 * This wrapper stays because the request pipeline fuses coercion into building
 * the params/query/headers object straight from the transport, in one pass with
 * no intermediate value to hand to a parser, and because `Coercion` names a
 * narrower set of kinds than JSON Schema's `type`.
 */
export const coercePrimitive = (raw: string, kind: 'number' | 'boolean'): unknown => coerceScalar(raw, kind)
