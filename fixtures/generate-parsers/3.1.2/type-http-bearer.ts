import { isObject } from 'mjst-helpers/is-object';

export type TypeHttpBearerObject = {
  type: "http";
  scheme: string;
  bearerFormat: string;
};

export const parseTypeHttpBearerObject = (input: unknown): TypeHttpBearerObject => {
  if (!isObject(input)) return {
        type: undefined,
        scheme: "",
      };
  return {
    ...input,
    type: input?.type === "http" ? input?.type : "http",
    scheme: typeof input?.scheme === "string" && /^[Bb][Ee][Aa][Rr][Ee][Rr]$/.test(input?.scheme) ? input?.scheme : (input?.scheme !== undefined ? String(input?.scheme) : ""),
    ...(input.bearerFormat !== undefined && { bearerFormat: typeof input?.bearerFormat === "string" ? input?.bearerFormat : String(input?.bearerFormat) }),
  };
}