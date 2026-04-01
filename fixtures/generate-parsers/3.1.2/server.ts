import { type ServerVariableObject, parseServerVariableObject } from './server-variable';
import { validateRecord } from 'mjst-helpers/validate-record';
import { isObject } from 'mjst-helpers/is-object';

/**
* Server object
*
* An object representing a Server.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#server-object}
*/
export type ServerObject = {
  /** **REQUIRED**. A URL to the target host. This URL supports Server Variables and MAY be relative, to indicate that the host location is relative to the location where the document containing the Server Object is being served. Query and fragment MUST NOT be part of this URL. Variable substitutions will be made when a variable is named in `{`braces`}`. */
  url: string;
  /** An optional string describing the host designated by the URL. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. */
  description?: string;
  /** A map between a variable name and its value. The value is used for substitution in the server's URL template. */
  variables?: Record<string, ServerVariableObject>;
} & Record<`x-${string}`, unknown>;

export const parseServerObject = (input: unknown): ServerObject => {
  if (!isObject(input)) return {
        url: "",
      };
  const _variables = input.variables;
  return {
    ...input,
    url: typeof input?.url === "string" ? input?.url : (input?.url !== undefined ? String(input?.url) : ""),
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(_variables !== undefined && { variables: validateRecord(_variables, parseServerVariableObject) }),
  };
}