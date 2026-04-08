import { isObject } from 'mjst-helpers/is-object';

export type ExternalDocumentationObject = {
  description?: string;
  url: string;
} & Record<`x-${string}`, unknown>;

export const parseExternalDocumentationObject = (input: unknown): ExternalDocumentationObject => {
  if (!isObject(input)) return {
        url: "",
      };
  const _description = input.description;
  const _url = input.url;
  if ((_description === undefined || typeof _description === "string") && typeof _url === "string") return input as ExternalDocumentationObject;
  return {
    ...input,
    ...(_description !== undefined && { description: typeof _description === "string" ? _description : String(_description) }),
    url: typeof _url === "string" ? _url : (_url !== undefined ? String(_url) : ""),
  };
}