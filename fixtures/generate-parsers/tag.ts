import { type ExternalDocumentationObject, parseExternalDocumentationObject } from './external-documentation';
import { isObject } from 'mjst-helpers/is-object';

export type TagObject = {
  name: string;
  description?: string;
  externalDocs?: ExternalDocumentationObject;
} & Record<`x-${string}`, unknown>;

export const parseTagObject = (input: unknown): TagObject => {
  if (!isObject(input)) return {
        name: "",
      };
  const _externalDocs = input.externalDocs;
  return {
    ...input,
    name: typeof input?.name === "string" ? input?.name : (input?.name !== undefined ? String(input?.name) : ""),
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(_externalDocs !== undefined && { externalDocs: parseExternalDocumentationObject(_externalDocs) }),
  } as unknown as TagObject;
}