import type { ReferenceObject } from './reference';
import { type ContentObject, parseContentObject } from './content';
import { type ExampleObject, parseExampleObject } from './example';
import { type SchemaObject, parseSchemaObject } from './schema';
import { validateRecord } from '@amritk/helpers/validate-record';
import { isObject } from '@amritk/helpers/is-object';

/**
* Parameter object
*
* Describes a single operation parameter.  A unique parameter is defined by a combination of a [name](#parameter-name) and [location](#parameter-in).  See [Appendix E](#appendix-e-percent-encoding-and-form-media-types) for a detailed examination of percent-encoding concerns, including interactions with the `application/x-www-form-urlencoded` query string format.
* 
* @see {@link https://spec.openapis.org/oas/v3.2#parameter-object}
*/
export type ParameterObject = {
  /** Example of the parameter's potential value; see [Working With Examples](https://spec.openapis.org/oas/v3.2#working-with-examples). */
  example?: unknown;
  /** Examples of the parameter's potential value; see [Working With Examples](https://spec.openapis.org/oas/v3.2#working-with-examples). */
  examples?: Record<string, ExampleObject | ReferenceObject>;
  /** **REQUIRED**. The name of the parameter. Parameter names are _case-sensitive_. <ul><li>If [`in`](https://spec.openapis.org/oas/v3.2#parameter-in) is `"path"`, the `name` field MUST correspond to a single template expression occurring within the [path](https://spec.openapis.org/oas/v3.2#paths-path) field in the [Paths Object](https://spec.openapis.org/oas/v3.2#paths-object). See [Path Templating](https://spec.openapis.org/oas/v3.2#path-templating) for further information.<li>If [`in`](https://spec.openapis.org/oas/v3.2#parameter-in) is `"header"` and the `name` field is `"Accept"`, `"Content-Type"` or `"Authorization"`, the parameter definition SHALL be ignored.<li>If `in` is `"querystring"`, or for [certain combinations](https://spec.openapis.org/oas/v3.2#style-examples) of [`style`](https://spec.openapis.org/oas/v3.2#parameter-style) and [`explode`](https://spec.openapis.org/oas/v3.2#parameter-explode), the value of `name` is not used in the parameter serialization.<li>For all other cases, the `name` corresponds to the parameter name used by the [`in`](https://spec.openapis.org/oas/v3.2#parameter-in) field.</ul> */
  name: string;
  /** **REQUIRED**. The location of the parameter. Possible values are `"query"`, `"querystring"`, `"header"`, `"path"` or `"cookie"`. */
  in: "query" | "querystring" | "header" | "path" | "cookie";
  /** A brief description of the parameter. This could contain examples of use. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. */
  description?: string;
  /** Determines whether this parameter is mandatory. If the [parameter location](https://spec.openapis.org/oas/v3.2#parameter-in) is `"path"`, this field is **REQUIRED** and its value MUST be `true`. Otherwise, the field MAY be included and its default value is `false`. */
  required?: boolean;
  /** Specifies that a parameter is deprecated and SHOULD be transitioned out of usage. Default value is `false`. */
  deprecated?: boolean;
  /** The schema defining the type used for the parameter. */
  schema?: SchemaObject;
  /** A map containing the representations for the parameter. The key is the media type and the value describes it. The map MUST only contain one entry. */
  content?: ContentObject;
};

export const parseParameterObject = (input: unknown): ParameterObject => {
  if (!isObject(input)) return {
        name: "",
        in: "query",
      };
  const _examples = input.examples;
  const _schema = input.schema;
  const _content = input.content;
  return {
    ...input,
    ...(_examples !== undefined && { examples: validateRecord(_examples, parseExampleObject) }),
    name: typeof input?.name === "string" ? input?.name : (input?.name !== undefined ? String(input?.name) : ""),
    in: ["query","querystring","header","path","cookie"].includes(input?.in as never) ? input?.in : "query",
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(input.required !== undefined && { required: typeof input?.required === "boolean" ? input?.required : Boolean(input?.required) }),
    ...(input.deprecated !== undefined && { deprecated: typeof input?.deprecated === "boolean" ? input?.deprecated : Boolean(input?.deprecated) }),
    ...(_schema !== undefined && { schema: parseSchemaObject(_schema) }),
    ...(_content !== undefined && { content: parseContentObject(_content) }),
  } as unknown as ParameterObject;
}