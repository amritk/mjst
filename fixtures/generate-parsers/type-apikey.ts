import { isObject } from 'mjst-helpers/is-object';

export type TypeApikeyObject = {
  type: "apiKey";
  name: string;
  in: "query" | "header" | "cookie";
};

export const parseTypeApikeyObject = (input: unknown): TypeApikeyObject => {
  if (!isObject(input)) return {} as TypeApikeyObject;
  return {
    ...input,
    type: input?.type === "apiKey" ? input?.type : "apiKey",
    name: typeof input?.name === "string" ? input?.name : (input?.name !== undefined ? String(input?.name) : ""),
    in: ["query","header","cookie"].includes(input?.in as never) ? input?.in : "query",
  } as unknown as TypeApikeyObject;
}