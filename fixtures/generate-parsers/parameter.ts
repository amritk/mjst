import { type ContentObject, parseContentObject } from './content';
import { type SchemaObject, parseSchemaObject } from './schema';
import { isObject } from 'mjst-helpers/is-object';

/**
* Parameter object
*
* Describes a single operation parameter.  A unique parameter is defined by a combination of a [name](#parameterName) and [location](#parameterIn).
* 
* @see {@link https://spec.openapis.org/oas/v3.1#parameter-object}
*/
export type ParameterObject = {
  /** **REQUIRED**. The location of the parameter. Possible values are `"query"`, `"header"`, `"path"` or `"cookie"`. */
  in: "query";
  /** Sets the ability to pass empty-valued parameters. This is valid only for `query` parameters and allows sending a parameter with an empty value. Default value is `false`. If [`style`](https://spec.openapis.org/oas/v3.1#parameterStyle) is used, and if behavior is `n/a` (cannot be serialized), the value of `allowEmptyValue` SHALL be ignored. Use of this property is NOT RECOMMENDED, as it is likely to be removed in a later revision. */
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