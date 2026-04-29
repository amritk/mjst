import { isObject } from '@amritk/helpers/is-object';

/**
* Server Variable object
*
* An object representing a Server Variable for server URL template substitution.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#server-variable-object}
*/
export type ServerVariableObject = {
  /** An enumeration of string values to be used if the substitution options are from a limited set. The array MUST NOT be empty. */
  enum?: string[];
  /** **REQUIRED**. The default value to use for substitution, which SHALL be sent if an alternate value is _not_ supplied. If the [`enum`](https://spec.openapis.org/oas/v3.1#server-variable-enum) is defined, the value MUST exist in the enum's values. Note that this behavior is different from the [Schema Object](https://spec.openapis.org/oas/v3.1#schema-object)'s `default` keyword, which documents the receiver's behavior rather than inserting the value into the data. */
  default: string;
  /** An optional description for the server variable. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. */
  description?: string;
} & Record<`x-${string}`, unknown>;

export const parseServerVariableObject = (input: unknown): ServerVariableObject => {
  if (!isObject(input)) return {
        default: "",
      };
  const _enum = input.enum;
  const _default = input.default;
  const _description = input.description;
  if ((_enum === undefined || Array.isArray(_enum) && _enum.length >= 1) && typeof _default === "string" && (_description === undefined || typeof _description === "string")) return { ...input } as ServerVariableObject;
  return {
    ...input,
    ...(_enum !== undefined && { enum: Array.isArray(_enum) && _enum.length >= 1 ? _enum : [] }),
    default: typeof _default === "string" ? _default : (_default !== undefined ? String(_default) : ""),
    ...(_description !== undefined && { description: typeof _description === "string" ? _description : String(_description) }),
  } as unknown as ServerVariableObject;
}