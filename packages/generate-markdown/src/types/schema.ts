/**
 * Describes the shape of a single property entry inside a JSON Schema object,
 * as the renderer sees it — every `$ref` is already inlined by
 * {@link dereference}, so no reference keyword appears here. We include the x-
 * extension fields we added so the generator can produce richer output (CLI flag
 * labels, icons) without hard-coding them here, plus the composition
 * (`enum`/`const`/`anyOf`/…) keywords that real-world schemas lean on. `type` is
 * optional because a property can describe itself purely through those keywords;
 * {@link displayType} fills the gap.
 *
 * Only the keywords the renderer actually reads are listed: a member here is a
 * claim that some cell is driven by it.
 */
export type SchemaProperty = {
  readonly type?: string | readonly string[]
  readonly description?: string
  readonly default?: unknown
  readonly enum?: readonly unknown[]
  readonly const?: unknown
  readonly examples?: readonly unknown[]
  readonly required?: readonly string[]
  readonly properties?: Readonly<Record<string, SchemaProperty>>
  readonly items?: SchemaProperty | readonly SchemaProperty[]
  readonly anyOf?: readonly SchemaProperty[]
  readonly oneOf?: readonly SchemaProperty[]
  readonly allOf?: readonly SchemaProperty[]
  /** Tuple positions. Read alongside the array form of `items` (draft-07's spelling). */
  readonly prefixItems?: readonly SchemaProperty[]
  readonly then?: SchemaProperty
  readonly else?: SchemaProperty
  readonly dependentSchemas?: Readonly<Record<string, SchemaProperty>>
  /** Draft-07's spelling. A schema value means `dependentSchemas`; an array of names does not. */
  readonly dependencies?: Readonly<Record<string, SchemaProperty | readonly string[]>>
  readonly patternProperties?: Readonly<Record<string, SchemaProperty>>
  readonly 'x-cli-flag'?: string
  readonly 'x-icon'?: string
  /**
   * The prose reference renderer's own keyword. Left as an open record here:
   * `readDocMeta` is what gives it a shape, and it does so defensively, because
   * a config schema is parsed JSON rather than validated input.
   */
  readonly 'x-doc'?: Readonly<Record<string, unknown>>
  readonly title?: string
  readonly deprecated?: boolean
  readonly format?: string
  readonly pattern?: string
  readonly minimum?: number
  readonly maximum?: number
  readonly exclusiveMinimum?: number
  readonly exclusiveMaximum?: number
  readonly minLength?: number
  readonly maxLength?: number
  readonly minItems?: number
  readonly maxItems?: number
  readonly multipleOf?: number
  readonly uniqueItems?: boolean
  /** A map-like object documents its value shape here rather than in `properties`. */
  readonly additionalProperties?: SchemaProperty | boolean
}

/**
 * The top-level structure of our config.schema.json file, again as the renderer
 * sees it: `$defs` has already been inlined into the properties that referenced
 * it, so the root is just the required list and the properties to render.
 */
export type ConfigSchema = {
  readonly title?: string
  readonly description?: string
  readonly required?: readonly string[]
  readonly properties?: Readonly<Record<string, SchemaProperty>>
  readonly 'x-doc'?: Readonly<Record<string, unknown>>
}
