/**
 * How a schema spells its array positions, normalised across the two dialects
 * the generator accepts.
 *
 * 2020-12 lists the fixed positions in `prefixItems` and types the rest with
 * `items`. Draft-07 (and anything a converter left in that shape — see the note
 * in `@amritk/adapters`' Valibot converter) puts the fixed positions in an
 * *array* `items` and types the rest with `additionalItems`. Reading only the
 * 2020-12 spelling is what let a draft-07 tuple emit no array validation at all
 * while the type generator wrote out a real tuple type.
 *
 * - `tuple` — the fixed positions, or `undefined` when the array is not a tuple.
 * - `tail` — the schema for every index past the tuple, or `undefined` when none
 *   is declared. `false` means "there must be no such index".
 * - `tailIsClosed` — whether a tuple's length is capped. A 2020-12 `prefixItems`
 *   paired with a draft-07 `additionalItems: false` counts, since documents in
 *   the wild do mix the two.
 *
 * `prefixItems` wins when a node carries both, which is the order
 * `@amritk/helpers/generate-type-definition` and `@amritk/runtime-validators`
 * already read them in. Reading the array `items` first instead made the
 * validator enforce one tuple while the *type* emitted beside it described the
 * other — the same type/validator split this normalisation exists to close.
 */
export const tupleShapeOf = (
  schema: Record<string, unknown>,
): { tuple: unknown[] | undefined; tail: unknown; tailIsClosed: boolean } => {
  const items = schema['items']
  const prefix = schema['prefixItems']
  if (Array.isArray(prefix)) {
    return {
      tuple: prefix,
      tail: 'items' in schema && !Array.isArray(items) ? items : undefined,
      tailIsClosed: items === false || schema['additionalItems'] === false,
    }
  }
  if (Array.isArray(items)) {
    return { tuple: items, tail: schema['additionalItems'], tailIsClosed: schema['additionalItems'] === false }
  }
  return {
    tuple: undefined,
    tail: 'items' in schema ? items : undefined,
    tailIsClosed: items === false || schema['additionalItems'] === false,
  }
}
