import { type ContentObject, parseContentObject } from './content';
import { type SchemaObject, parseSchemaObject } from './schema';
import { isObject } from 'mjst-helpers/is-object';

/**
* Parameter object
*
* Describes a single operation parameter.  A unique parameter is defined by a combination of a [name](#parameter-name) and [location](#parameter-in).  See [Appendix E](#appendix-e-percent-encoding-and-form-media-types) for a detailed examination of percent-encoding concerns, including interactions with the `application/x-www-form-urlencoded` query string format.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#parameter-object}
*/
export type ParameterObject = {
  in: "query";
  allowEmptyValue: boolean;
} & Record<`x-${string}`, unknown>;

export const parseParameterObject = (input: unknown): ParameterObject => {
  if (!isObject(input)) return {
        name: "",
        in: "query",
      };
  const _schema = input.schema;
  const _content = input.content;
  return {
    ...input,
    name: typeof input?.name === "string" ? input?.name : (input?.name !== undefined ? String(input?.name) : ""),
    in: ["query","header","path","cookie"].includes(input?.in) ? input?.in : "query",
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(input.required !== undefined && { required: typeof input?.required === "boolean" ? input?.required : Boolean(input?.required) }),
    ...(input.deprecated !== undefined && { deprecated: typeof input?.deprecated === "boolean" ? input?.deprecated : Boolean(input?.deprecated) }),
    ...(_schema !== undefined && { schema: parseSchemaObject(_schema) }),
    ...(_content !== undefined && { content: parseContentObject(_content) }),
  };
}