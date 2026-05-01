import { type ExternalDocsObject, parseExternalDocsObject } from './external-docs';
import { isObject } from '@amritk/helpers/is-object';

/**
* Tag object
*
* Allows adding meta data to a single tag that is used by the [Operation Object](#operation-object). It is not mandatory to have a Tag Object per tag used there.
* 
* @see {@link https://swagger.io/specification/v2/#tag-object}
*/
export type TagObject = {
  /** **Required.** The name of the tag. */
  name: string;
  /** A short description for the tag. [GFM syntax](https://guides.github.com/features/mastering-markdown/#GitHub-flavored-markdown) can be used for rich text representation. */
  description?: string;
  /** Additional external documentation for this tag. */
  externalDocs?: ExternalDocsObject;
};

export const parseTagObject = (input: unknown): TagObject => {
  if (!isObject(input)) {
    return {} as unknown as TagObject;
  }
  const result = {
    ...input,
    name: typeof input?.name === "string" ? input?.name : (input?.name !== undefined ? String(input?.name) : ""),
    ...((value => value === undefined ? {} : { description: value })(typeof input?.description === "string" ? input?.description : (input?.description !== undefined ? String(input?.description) : undefined))),
    ...(input.externalDocs && { externalDocs: parseExternalDocsObject(input.externalDocs) }),
  } as unknown as TagObject;
  for (const key in input) {
    if (/^x-/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};