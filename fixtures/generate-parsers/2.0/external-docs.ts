import { isObject } from '@amritk/helpers/is-object';

/**
* External Documentation object
*
* Allows referencing an external resource for extended documentation.
* 
* @see {@link https://swagger.io/specification/v2/#external-documentation-object}
*/
export type ExternalDocsObject = {
  /** A short description of the target documentation. [GFM syntax](https://guides.github.com/features/mastering-markdown/#GitHub-flavored-markdown) can be used for rich text representation. */
  description?: string;
  /** **Required.** The URL for the target documentation. Value MUST be in the format of a URL. */
  url: string;
};

export const parseExternalDocsObject = (input: unknown): ExternalDocsObject => {
  if (!isObject(input)) {
    return {} as unknown as ExternalDocsObject;
  }
  const result = {
    ...input,
    ...((value => value === undefined ? {} : { description: value })(typeof input?.description === "string" ? input?.description : (input?.description !== undefined ? String(input?.description) : undefined))),
    url: typeof input?.url === "string" ? input?.url : (input?.url !== undefined ? String(input?.url) : ""),
  } as unknown as ExternalDocsObject;
  for (const key in input) {
    if (/^x-/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};