import { isObject } from 'mjst-helpers/is-object';

export type TypeHttpObject = {
  type: "http";
  scheme: string;
};

export const parseTypeHttpObject = (input: unknown): TypeHttpObject => {
  if (!isObject(input)) return {
        scheme: "",
      };
  return {
    ...input,
    ...(input.type !== undefined && { type: input?.type === "http" ? input?.type : "http" }),
    scheme: typeof input?.scheme === "string" ? input?.scheme : (input?.scheme !== undefined ? String(input?.scheme) : ""),
  };
}