import { type ServerVariableObject, parseServerVariableObject } from './server-variable';
import { validateRecord } from 'mjst-helpers/validate-record';
import { isObject } from 'mjst-helpers/is-object';

export type ServerObject = {
  url: string;
  description?: string;
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