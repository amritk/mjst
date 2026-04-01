import { type EncodingObject, parseEncodingObject } from './encoding';
import { type ExamplesObject, parseExamplesObject } from './examples';
import { type SchemaObject, parseSchemaObject } from './schema';
import { validateRecord } from 'mjst-helpers/validate-record';
import { isObject } from 'mjst-helpers/is-object';

/**
* Media Type object
*
* Each Media Type Object provides schema and examples for the media type identified by its key.  When `example` or `examples` are provided, the example SHOULD match the specified schema and be in the correct format as specified by the media type and its encoding. The `example` and `examples` fields are mutually exclusive, and if either is present it SHALL _override_ any `example` in the schema. See [Working With Examples](#working-with-examples) for further guidance regarding the different ways of specifying examples, including non-JSON/YAML values.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#media-type-object}
*/
export type MediaTypeObject = {
  /** The schema defining the content of the request, response, parameter, or header. */
  schema?: SchemaObject;
  /** A map between a property name and its encoding information. The key, being the property name, MUST exist in the schema as a property. The `encoding` field SHALL only apply to [Request Body Objects](https://spec.openapis.org/oas/v3.1#request-body-object), and only when the media type is `multipart` or `application/x-www-form-urlencoded`. If no Encoding Object is provided for a property, the behavior is determined by the default values documented for the Encoding Object. */
  encoding?: Record<string, EncodingObject>;
};

export const parseMediaTypeObject = (input: unknown): MediaTypeObject => {
  if (!isObject(input)) return {};
  const _schema = input.schema;
  const _encoding = input.encoding;
  return {
    ...input,
    ...(_schema !== undefined && { schema: parseSchemaObject(_schema) }),
    ...(_encoding !== undefined && { encoding: validateRecord(_encoding, parseEncodingObject) }),
  };
}