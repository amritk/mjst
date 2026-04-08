import { isObject } from 'mjst-helpers/is-object';

export type ServerVariableObject = {
  enum?: string[];
  default: string;
  description?: string;
} & Record<`x-${string}`, unknown>;

export const parseServerVariableObject = (input: unknown): ServerVariableObject => {
  if (!isObject(input)) return {
        default: "",
      };
  const _enum = input.enum;
  const _default = input.default;
  const _description = input.description;
  if ((_enum === undefined || Array.isArray(_enum) && _enum.length >= 1) && typeof _default === "string" && (_description === undefined || typeof _description === "string")) return input as ServerVariableObject;
  return {
    ...input,
    ...(_enum !== undefined && { enum: Array.isArray(_enum) && _enum.length >= 1 ? _enum : [] }),
    default: typeof _default === "string" ? _default : (_default !== undefined ? String(_default) : ""),
    ...(_description !== undefined && { description: typeof _description === "string" ? _description : String(_description) }),
  };
}