import { type ExampleObject, parseExampleObject } from './example';
import { type ExampleXorExamplesObject, parseExampleXorExamplesObject } from './example-xor-examples';
import { type MediaTypeObject, parseMediaTypeObject } from './media-type';
import { type ReferenceObject, parseReferenceObject } from './reference';
import { type SchemaObject, parseSchemaObject } from './schema';
import { type SchemaXorContentObject, parseSchemaXorContentObject } from './schema-xor-content';
import { validateRecord } from 'mjst-helpers/validate-record';
import { isObject } from 'mjst-helpers/is-object';

/**
* Header object
*
* Describes a single header for [HTTP responses](#response-headers) and for [individual parts in `multipart` representations](#encoding-headers); see the relevant [Response Object](#response-object) and [Encoding Object](#encoding-object) documentation for restrictions on which headers can be described.  The Header Object follows the structure of the [Parameter Object](#parameter-object), including determining its serialization strategy based on whether `schema` or `content` is present, with the following changes:  1. `name` MUST NOT be specified, it is given in the corresponding `headers` map. 1. `in` MUST NOT be specified, it is implicitly in `header`. 1. All traits that are affected by the location MUST be applicable to a location of `header` (for example, [`style`](#parameter-style)). This means that `allowEmptyValue` and `allowReserved` MUST NOT be used, and `style`, if used, MUST be limited to `"simple"`.
* 
* @see {@link https://spec.openapis.org/oas/v3.0.4#header-object}
*/
export type HeaderObject = {
  /** A brief description of the header. This could contain examples of use. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. */
  description?: string;
  /** Determines whether this header is mandatory. The default value is `false`. */
  required?: boolean;
  /** Specifies that the header is deprecated and SHOULD be transitioned out of usage. Default value is `false`. */
  deprecated?: boolean;
  allowEmptyValue?: boolean;
  /** Describes how the header value will be serialized. The default (and only legal value for headers) is `"simple"`. */
  style?: "simple";
  /** When this is true, header values of type `array` or `object` generate a single header whose value is a comma-separated list of the array items or key-value pairs of the map, see [Style Examples](https://spec.openapis.org/oas/v3.0.4#style-examples). For other data types this field has no effect. The default value is `false`. */
  explode?: boolean;
  allowReserved?: boolean;
  /** The schema defining the type used for the header. */
  schema?: SchemaObject | ReferenceObject;
  /** A map containing the representations for the header. The key is the media type and the value describes it. The map MUST only contain one entry. */
  content?: Record<string, MediaTypeObject>;
  /** Example of the header's potential value; see [Working With Examples](https://spec.openapis.org/oas/v3.0.4#working-with-examples). */
  example?: unknown;
  /** Examples of the header's potential value; see [Working With Examples](https://spec.openapis.org/oas/v3.0.4#working-with-examples). */
  examples?: Record<string, ExampleObject | ReferenceObject>;
} & ExampleXorExamplesObject & SchemaXorContentObject;

export const parseHeaderObject = (input: unknown): HeaderObject => {
  if (!isObject(input)) return {} as HeaderObject;
  const _content = input.content;
  return {
    ...input,
    ...(parseExampleXorExamplesObject(input) as Record<string, unknown>),
    ...(parseSchemaXorContentObject(input) as Record<string, unknown>),
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(input.required !== undefined && { required: typeof input?.required === "boolean" ? input?.required : Boolean(input?.required) }),
    ...(input.deprecated !== undefined && { deprecated: typeof input?.deprecated === "boolean" ? input?.deprecated : Boolean(input?.deprecated) }),
    ...(input.allowEmptyValue !== undefined && { allowEmptyValue: typeof input?.allowEmptyValue === "boolean" ? input?.allowEmptyValue : Boolean(input?.allowEmptyValue) }),
    ...(input.style !== undefined && { style: typeof input?.style === "string" && ["simple"].includes(input?.style as never) ? input?.style : String(input?.style) }),
    ...(input.explode !== undefined && { explode: typeof input?.explode === "boolean" ? input?.explode : Boolean(input?.explode) }),
    ...(input.allowReserved !== undefined && { allowReserved: typeof input?.allowReserved === "boolean" ? input?.allowReserved : Boolean(input?.allowReserved) }),
    ...(input.schema !== undefined && { schema: input?.schema ?? undefined }),
    ...(_content !== undefined && { content: validateRecord(_content, parseMediaTypeObject) }),
    ...(input.example !== undefined && { example: input?.example ?? undefined }),
    ...(input.examples !== undefined && { examples: isObject(input?.examples) ? input?.examples : typeof input?.examples === "object" && input?.examples !== null ? input?.examples : {} }),
  } as unknown as HeaderObject;
}