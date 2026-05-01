import { type EncodingObject, parseEncodingObject } from './encoding';
import { type ExampleObject, parseExampleObject } from './example';
import { type ExampleXorExamplesObject, parseExampleXorExamplesObject } from './example-xor-examples';
import { type ReferenceObject, parseReferenceObject } from './reference';
import { type SchemaObject, parseSchemaObject } from './schema';
import { validateRecord } from '@amritk/helpers/validate-record';
import { isObject } from '@amritk/helpers/is-object';

/**
* Media Type object
*
* Each Media Type Object provides schema and examples for the media type identified by its key.  When `example` or `examples` are provided, the example SHOULD match the specified schema and be in the correct format as specified by the media type and its encoding. The `example` and `examples` fields are mutually exclusive, and if either is present it SHALL _override_ any `example` in the schema. See [Working With Examples](#working-with-examples) for further guidance regarding the different ways of specifying examples, including non-JSON/YAML values.
* 
* @see {@link https://spec.openapis.org/oas/v3.0.4#media-type-object}
*/
export type MediaTypeObject = {
  /** The schema defining the content of the request, response, parameter, or header. */
  schema?: SchemaObject | ReferenceObject;
  /** Example of the media type; see [Working With Examples](https://spec.openapis.org/oas/v3.0.4#working-with-examples). */
  example?: unknown;
  /** Examples of the media type; see [Working With Examples](https://spec.openapis.org/oas/v3.0.4#working-with-examples). */
  examples?: Record<string, ExampleObject | ReferenceObject>;
  /** A map between a property name and its encoding information. The key, being the property name, MUST exist in the schema as a property. The `encoding` field SHALL only apply to [Request Body Objects](https://spec.openapis.org/oas/v3.0.4#request-body-object), and only when the media type is `multipart` or `application/x-www-form-urlencoded`. If no Encoding Object is provided for a property, the behavior is determined by the default values documented for the Encoding Object. */
  encoding?: Record<string, EncodingObject>;
} & ExampleXorExamplesObject;

export const parseMediaTypeObject = (input: unknown): MediaTypeObject => {
  if (!isObject(input)) return {} as MediaTypeObject;
  const _encoding = input.encoding;
  return {
    ...input,
    ...(parseExampleXorExamplesObject(input) as Record<string, unknown>),
    ...(input.schema !== undefined && { schema: input?.schema ?? undefined }),
    ...(input.example !== undefined && { example: input?.example ?? undefined }),
    ...(input.examples !== undefined && { examples: isObject(input?.examples) ? input?.examples : typeof input?.examples === "object" && input?.examples !== null ? input?.examples : {} }),
    ...(_encoding !== undefined && { encoding: validateRecord(_encoding, parseEncodingObject) }),
  } as unknown as MediaTypeObject;
}