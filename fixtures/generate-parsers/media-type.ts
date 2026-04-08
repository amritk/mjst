import type { ReferenceObject } from './reference';
import { type EncodingObject, parseEncodingObject } from './encoding';
import { type ExampleObject, parseExampleObject } from './example';
import { type SchemaObject, parseSchemaObject } from './schema';
import { validateRecord } from 'mjst-helpers/validate-record';
import { isObject } from 'mjst-helpers/is-object';

export type MediaTypeObject = {
  example?: boolean;
  examples?: Record<string, ExampleObject | ReferenceObject>;
  schema?: SchemaObject;
  encoding?: Record<string, EncodingObject>;
};

export const parseMediaTypeObject = (input: unknown): MediaTypeObject => {
  if (!isObject(input)) return {};
  const _examples = input.examples;
  const _schema = input.schema;
  const _encoding = input.encoding;
  return {
    ...input,
    ...(_examples !== undefined && { examples: validateRecord(_examples, parseExampleObject) }),
    ...(_schema !== undefined && { schema: parseSchemaObject(_schema) }),
    ...(_encoding !== undefined && { encoding: validateRecord(_encoding, parseEncodingObject) }),
  };
}