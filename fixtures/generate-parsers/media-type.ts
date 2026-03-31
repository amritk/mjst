import { type EncodingObject, parseEncodingObject } from './encoding';
import { type ExamplesObject, parseExamplesObject } from './examples';
import { type SchemaObject, parseSchemaObject } from './schema';
import { type SpecificationExtensionsObject, parseSpecificationExtensionsObject } from './specification-extensions';
import { validateRecord } from './validators/validate-record';
import { isObject } from './helpers/is-object';

/**
* Media Type object
*
* Each Media Type Object provides schema and examples for the media type identified by its key.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#media-type-object}
*/
export type MediaTypeObject = {
  /** The schema defining the content of the request, response, or parameter. */
  schema?: SchemaObject;
  /** A map between a property name and its encoding information. The key, being the property name, MUST exist in the schema as a property. The encoding object SHALL only apply to `requestBody` objects when the media type is `multipart` or `application/x-www-form-urlencoded`. */
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