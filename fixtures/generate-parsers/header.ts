import { type ContentObject, parseContentObject } from './content';
import { type SchemaObject, parseSchemaObject } from './schema';
import { isObject } from 'mjst-helpers/is-object';

/**
* Header object
*
* The Header Object follows the structure of the [Parameter Object](#parameter-object) with the following changes:  1. `name` MUST NOT be specified, it is given in the corresponding `headers` map. 1. `in` MUST NOT be specified, it is implicitly in `header`. 1. All traits that are affected by the location MUST be applicable to a location of `header` (for example, [`style`](#parameterStyle)).
* 
* @see {@link https://spec.openapis.org/oas/v3.1#header-object}
*/
export type HeaderObject = {
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  schema?: SchemaObject;
  content?: ContentObject;
} & Record<`x-${string}`, unknown>;

export const parseHeaderObject = (input: unknown): HeaderObject => {
  if (!isObject(input)) return {};
  const _schema = input.schema;
  const _content = input.content;
  return {
    ...input,
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(input.required !== undefined && { required: typeof input?.required === "boolean" ? input?.required : Boolean(input?.required) }),
    ...(input.deprecated !== undefined && { deprecated: typeof input?.deprecated === "boolean" ? input?.deprecated : Boolean(input?.deprecated) }),
    ...(_schema !== undefined && { schema: parseSchemaObject(_schema) }),
    ...(_content !== undefined && { content: parseContentObject(_content) }),
  };
}