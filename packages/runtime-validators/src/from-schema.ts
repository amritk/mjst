/**
 * Infers the TypeScript type of data that satisfies a JSON Schema, reading the
 * schema as a literal at the type level.
 *
 * This is the static mirror of what {@link validate} and {@link validateGuard} do
 * at runtime: where the interpreter *checks* a value against the schema, this
 * *describes* the value the interpreter would accept. The two are independent
 * implementations of the same spec, so they can in principle drift — the
 * `from-schema.test.ts` suite exists to keep them honest.
 *
 * It only sees what the literal preserves, so write the schema `as const` (or let
 * {@link validate} / {@link validateGuard} infer it via their `const` type
 * parameter). Without that, TypeScript widens `type: 'string'` to `type: string`
 * and there is nothing left to read.
 *
 * Runtime-only constraints contribute no extra type. `minLength`, `pattern`,
 * `minimum`, `multipleOf` and friends all still leave a `string` as `string` and
 * a `number` as `number`, because that is the most TypeScript can express.
 *
 * Not modelled (these narrow at runtime but are skipped here so the inferred type
 * stays useful rather than collapsing to `never`/`unknown`): `$ref` /
 * `$dynamicRef`, `not`, `if` / `then` / `else`, `dependentSchemas`,
 * `dependencies`, `propertyNames`, and `unevaluated*`.
 *
 * @example
 * ```typescript
 * const schema = {
 *   type: 'object',
 *   properties: { id: { type: 'integer' }, name: { type: 'string' } },
 *   required: ['id'],
 * } as const
 *
 * type User = FromSchema<typeof schema>
 * //   ^? { id: number; name?: string }
 * ```
 */
export type FromSchema<S> = S extends true
  ? unknown
  : S extends false
    ? never
    : // OpenAPI `nullable: true` widens the inferred type with `null`, matching
      // how the interpreter accepts `null` regardless of the declared `type`.
      S extends { nullable: true }
      ? FromSchemaCore<S> | null
      : FromSchemaCore<S>

/**
 * The body of {@link FromSchema}, split out so the `nullable` and boolean-schema
 * handling above stays readable. `const` and `enum` pin an exact value and so win
 * over everything else; otherwise the type is the intersection of the constraints
 * each present keyword contributes (an absent keyword contributes `unknown`, the
 * identity for `&`).
 */
type FromSchemaCore<S> = S extends object
  ? S extends { const: infer C }
    ? C
    : S extends { enum: infer E }
      ? EnumValues<E>
      : TypePart<S> & AllOf<S> & AnyOf<S> & OneOf<S>
  : unknown

/** Flattens an intersection of mapped types into a single, readable object type. */
type Simplify<T> = T extends object ? { [K in keyof T]: T[K] } : T

/** The union of an `enum`'s members, e.g. `['admin', 'user']` becomes `'admin' | 'user'`. */
type EnumValues<E> = E extends readonly (infer V)[] ? V : never

/**
 * Maps the `type` keyword to a TypeScript type. `type` may be a single name or an
 * array of names (a union); when it is absent entirely we still honour the
 * object/array applicator keywords, because the interpreter applies them
 * regardless of whether `type` is present.
 */
type TypePart<S> = S extends { type: infer T }
  ? T extends readonly unknown[]
    ? TypeUnion<T, S>
    : NameToType<T, S>
  : ImplicitShape<S>

/** Distributes {@link NameToType} across a `type` array, producing a union. */
type TypeUnion<T extends readonly unknown[], S> = T extends readonly [infer Head, ...infer Rest]
  ? NameToType<Head, S> | TypeUnion<Rest, S>
  : never

/** Maps a single JSON Schema `type` name to its TypeScript counterpart. */
type NameToType<Name, S> = Name extends 'string'
  ? string
  : Name extends 'number'
    ? number
    : Name extends 'integer'
      ? number
      : Name extends 'boolean'
        ? boolean
        : Name extends 'null'
          ? null
          : Name extends 'object'
            ? ObjectShape<S>
            : Name extends 'array'
              ? ArrayShape<S>
              : // An unmodelled `type` keyword matches anything, mirroring the
                // interpreter's "treat unknown types as always valid" stance.
                unknown

/**
 * When a schema omits `type` but carries object- or array-shaped keywords, infer
 * the corresponding shape. This matches the interpreter, which runs the object
 * and array applicators on any value of the right runtime type.
 */
type ImplicitShape<S> = S extends { properties: unknown }
  ? ObjectShape<S>
  : S extends { required: unknown }
    ? ObjectShape<S>
    : S extends { additionalProperties: unknown }
      ? ObjectShape<S>
      : S extends { patternProperties: unknown }
        ? ObjectShape<S>
        : S extends { prefixItems: unknown }
          ? ArrayShape<S>
          : S extends { items: unknown }
            ? ArrayShape<S>
            : unknown

/** The object shape: known `properties` plus whatever index signature the additional/pattern keywords imply. */
type ObjectShape<S> = Simplify<KnownProps<S> & IndexSignature<S>>

/** The set of property names listed in `required`. */
type RequiredNames<S> = S extends { required: infer R } ? (R extends readonly (infer K)[] ? K : never) : never

/**
 * The declared `properties`, split into required and optional members, plus any
 * `required` name that has no `properties` entry (the interpreter still demands
 * its presence, so it lands here as a required `unknown`).
 */
type KnownProps<S> = S extends { properties: infer P }
  ? { -readonly [K in keyof P as K extends RequiredNames<S> ? K : never]: FromSchema<P[K]> } & {
      -readonly [K in keyof P as K extends RequiredNames<S> ? never : K]?: FromSchema<P[K]>
    } & ExtraRequired<S, P>
  : unknown

/** Required names with no matching `properties` entry become required `unknown` members. */
type ExtraRequired<S, P> = [Exclude<RequiredNames<S>, keyof P>] extends [never]
  ? unknown
  : { [K in Exclude<RequiredNames<S>, keyof P> & string]: unknown }

/**
 * The index signature implied by `additionalProperties` / `patternProperties`.
 *
 * `additionalProperties: false` seals the object (no index signature). A schema
 * value types the extra members; `true`, or an absent keyword on a bare object,
 * admits `unknown` extras. When `properties` are present but `additionalProperties`
 * is absent we add no index signature, keeping the object shape exact and excess
 * property checks intact.
 */
type IndexSignature<S> = S extends { additionalProperties: false }
  ? unknown
  : S extends { additionalProperties: true }
    ? { [key: string]: unknown }
    : S extends { additionalProperties: infer AP }
      ? AP extends object
        ? { [key: string]: FromSchema<AP> }
        : unknown
      : S extends { patternProperties: infer PP }
        ? { [key: string]: PatternValues<PP> }
        : S extends { properties: unknown }
          ? unknown
          : { [key: string]: unknown }

/** The union of value types across every `patternProperties` subschema. */
type PatternValues<PP> = { [K in keyof PP]: FromSchema<PP[K]> }[keyof PP]

/**
 * The array shape, covering the 2020-12 tuple form (`prefixItems` + `items` as the
 * rest), the draft-07 tuple form (`items` array + `additionalItems`), and the
 * plain list form (`items` as a single subschema). A `false` rest seals the tuple;
 * an absent rest leaves the tail open as `unknown[]`, matching the interpreter.
 */
type ArrayShape<S> = S extends { prefixItems: infer P }
  ? P extends readonly unknown[]
    ? S extends { items: infer R }
      ? R extends false
        ? MapTuple<P>
        : [...MapTuple<P>, ...FromSchema<R>[]]
      : [...MapTuple<P>, ...unknown[]]
    : unknown[]
  : S extends { items: infer I }
    ? I extends readonly unknown[]
      ? S extends { additionalItems: infer AI }
        ? AI extends false
          ? MapTuple<I>
          : [...MapTuple<I>, ...FromSchema<AI>[]]
        : [...MapTuple<I>, ...unknown[]]
      : FromSchema<I>[]
    : unknown[]

/**
 * Maps a tuple of subschemas to a tuple of their inferred types, preserving
 * length. The `-readonly` strips the readonly a `const`-inferred schema carries,
 * so the inferred value is a normal mutable tuple.
 */
type MapTuple<P extends readonly unknown[]> = { -readonly [I in keyof P]: FromSchema<P[I]> }

/** `allOf` is the intersection of every branch. */
type AllOf<S> = S extends { allOf: infer A extends readonly unknown[] } ? IntersectAll<A> : unknown

/** `anyOf` is the union of every branch (a value matching any branch is accepted). */
type AnyOf<S> = S extends { anyOf: infer A extends readonly unknown[] } ? UnionAll<A> : unknown

/** `oneOf` is, at the type level, also the union of its branches. */
type OneOf<S> = S extends { oneOf: infer A extends readonly unknown[] } ? UnionAll<A> : unknown

/** Intersects every subschema in a tuple. Empty tuple yields `unknown`, the identity for `&`. */
type IntersectAll<A extends readonly unknown[]> = A extends readonly [infer Head, ...infer Rest]
  ? FromSchema<Head> & IntersectAll<Rest>
  : unknown

/** Unions every subschema in a tuple. Empty tuple yields `never`, the identity for `|`. */
type UnionAll<A extends readonly unknown[]> = A extends readonly [infer Head, ...infer Rest]
  ? FromSchema<Head> | UnionAll<Rest>
  : never
