import type { ReferenceObject } from './reference';
import { type EncodingObject, parseEncodingObject } from './encoding';
import { type ExampleObject, parseExampleObject } from './example';
import { type SchemaObject, parseSchemaObject } from './schema';
import { validateArray } from 'mjst-helpers/validate-array';
import { validateRecord } from 'mjst-helpers/validate-record';
import { isObject } from 'mjst-helpers/is-object';

/**
* Media Type object
*
* Each Media Type Object describes content structured in accordance with the media type identified by its key. Multiple Media Type Objects can be used to describe content that can appear in any of several different media types.  When `example` or `examples` are provided, the example SHOULD match the specified schema and be in the correct format as specified by the media type and its encoding. The `example` and `examples` fields are mutually exclusive. See [Working With Examples](#working-with-examples) for further guidance regarding the different ways of specifying examples, including non-JSON/YAML values.
* 
* @see {@link https://spec.openapis.org/oas/v3.2#media-type-object}
*/
export type MediaTypeObject = {
  /** Example of the media type; see [Working With Examples](https://spec.openapis.org/oas/v3.2#working-with-examples). */
  example?: unknown;
  /** Examples of the media type; see [Working With Examples](https://spec.openapis.org/oas/v3.2#working-with-examples). */
  examples?: Record<string, ExampleObject | ReferenceObject>;
  description?: string;
  /** A schema describing the complete content of the request, response, parameter, or header. */
  schema?: SchemaObject;
  /** A schema describing each item within a [sequential media type](https://spec.openapis.org/oas/v3.2#sequential-media-types). */
  itemSchema?: SchemaObject;
  /** A map between a property name and its encoding information, as defined under [Encoding By Name](https://spec.openapis.org/oas/v3.2#encoding-by-name).  The `encoding` field SHALL only apply when the media type is `multipart` or `application/x-www-form-urlencoded`. If no Encoding Object is provided for a property, the behavior is determined by the default values documented for the Encoding Object. This field MUST NOT be present if `prefixEncoding` or `itemEncoding` are present. */
  encoding?: Record<string, EncodingObject>;
  /** An array of positional encoding information, as defined under [Encoding By Position](https://spec.openapis.org/oas/v3.2#encoding-by-position).  The `prefixEncoding` field SHALL only apply when the media type is `multipart`. If no Encoding Object is provided for a property, the behavior is determined by the default values documented for the Encoding Object. This field MUST NOT be present if `encoding` is present. */
  prefixEncoding?: EncodingObject[];
  /** A single Encoding Object that provides encoding information for multiple array items, as defined under [Encoding By Position](https://spec.openapis.org/oas/v3.2#encoding-by-position). The `itemEncoding` field SHALL only apply when the media type is `multipart`. If no Encoding Object is provided for a property, the behavior is determined by the default values documented for the Encoding Object. This field MUST NOT be present if `encoding` is present. */
  itemEncoding?: EncodingObject;
};

export const parseMediaTypeObject = (input: unknown): MediaTypeObject => {
  if (!isObject(input)) return {} as MediaTypeObject;
  const _examples = input.examples;
  const _schema = input.schema;
  const _itemSchema = input.itemSchema;
  const _encoding = input.encoding;
  const _prefixEncoding = input.prefixEncoding;
  const _itemEncoding = input.itemEncoding;
  return {
    ...input,
    ...(_examples !== undefined && { examples: validateRecord(_examples, parseExampleObject) }),
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(_schema !== undefined && { schema: parseSchemaObject(_schema) }),
    ...(_itemSchema !== undefined && { itemSchema: parseSchemaObject(_itemSchema) }),
    ...(_encoding !== undefined && { encoding: validateRecord(_encoding, parseEncodingObject) }),
    ...(_prefixEncoding !== undefined && { prefixEncoding: validateArray(_prefixEncoding, parseEncodingObject) }),
    ...(_itemEncoding !== undefined && { itemEncoding: parseEncodingObject(_itemEncoding) }),
  } as unknown as MediaTypeObject;
}