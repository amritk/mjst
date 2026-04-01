import { isObject } from 'mjst-helpers/is-object';

/**
* External Documentation object
*
* Allows referencing an external resource for extended documentation.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#external-documentation-object}
*/
export type ExternalDocumentationObject = {
  /** A description of the target documentation. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. */
  description?: string;
  /** **REQUIRED**. The URL for the target documentation. This MUST be in the form of a URL. */
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