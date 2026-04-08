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
  /** **REQUIRED**. The location of the parameter. Possible values are `"query"`, `"header"`, `"path"` or `"cookie"`. */
  in: "query";
  /** If `true`, clients MAY pass a zero-length string value in place of parameters that would otherwise be omitted entirely, which the server SHOULD interpret as the parameter being unused. Default value is `false`. If [`style`](https://spec.openapis.org/oas/v3.1#parameter-style) is used, and if [behavior is _n/a_ (cannot be serialized)](https://spec.openapis.org/oas/v3.1#style-examples), the value of `allowEmptyValue` SHALL be ignored. Interactions between this field and the parameter's [Schema Object](https://spec.openapis.org/oas/v3.1#schema-object) are implementation-defined. This field is valid only for `query` parameters. Use of this field is NOT RECOMMENDED, and it is likely to be removed in a later revision. */
  allowEmptyValue: boolean;
} & Record<`x-${string}`, unknown>;

export const parseParameterObject = (input: unknown): ParameterObject => {
  if (!isObject(input)) return {} as ParameterObject;
  const _schema = input.schema;
  const _content = input.content;
  return {
    ...input,
    name: typeof input?.name === "string" ? input?.name : (input?.name !== undefined ? String(input?.name) : ""),
    in: ["query","header","path","cookie"].includes(input?.in as never) ? input?.in : "query",
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(input.required !== undefined && { required: typeof input?.required === "boolean" ? input?.required : Boolean(input?.required) }),
    ...(input.deprecated !== undefined && { deprecated: typeof input?.deprecated === "boolean" ? input?.deprecated : Boolean(input?.deprecated) }),
    ...(_schema !== undefined && { schema: parseSchemaObject(_schema) }),
    ...(_content !== undefined && { content: parseContentObject(_content) }),
  } as unknown as ParameterObject;
}