import { declaresKey, readKey } from '@amritk/helpers/read-key'

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
 * - `tailIsClosed` — whether a tuple's length is capped: `items: false` past a
 *   `prefixItems`, or `additionalItems: false` past an array `items`. Each
 *   dialect's own spelling only — `additionalItems` is not a 2020-12 keyword, and
 *   honouring it next to `prefixItems` made the validator cap a length that Ajv,
 *   the interpreter, and the tuple type emitted beside it all leave open.
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
  const items = readKey(schema, 'items')
  const prefix = readKey(schema, 'prefixItems')
  if (Array.isArray(prefix)) {
    return {
      tuple: prefix,
      tail: declaresKey(schema, 'items') && !Array.isArray(items) ? items : undefined,
      tailIsClosed: items === false,
    }
  }
  if (Array.isArray(items)) {
    const additionalItems = readKey(schema, 'additionalItems')
    return { tuple: items, tail: additionalItems, tailIsClosed: additionalItems === false }
  }
  return { tuple: undefined, tail: declaresKey(schema, 'items') ? items : undefined, tailIsClosed: items === false }
}
