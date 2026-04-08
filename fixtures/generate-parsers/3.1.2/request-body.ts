import { type ContentObject, parseContentObject } from './content';
import { isObject } from 'mjst-helpers/is-object';

/**
* Request Body object
*
* Describes a single request body.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#request-body-object}
*/
export type RequestBodyObject = {
  /** A brief description of the request body. This could contain examples of use. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. */
  description?: string;
  /** **REQUIRED**. The content of the request body. The key is a media type or [media type range](https://tools.ietf.org/html/rfc7231#appendix-D) and the value describes it. The map SHOULD have at least one entry; if it does not, the behavior is implementation-defined. For requests that match multiple keys, only the most specific key is applicable. e.g. `"text/plain"` overrides `"text/*"` */
  content: ContentObject;
  /** Determines if the request body is required in the request. Defaults to `false`. */
  required?: boolean;
} & Record<`x-${string}`, unknown>;

export const parseRequestBodyObject = (input: unknown): RequestBodyObject => {
  if (!isObject(input)) return {
        content: parseContentObject(undefined),
      };
  const _content = input.content;
  return {
    ...input,
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    content: parseContentObject(_content),
    ...(input.required !== undefined && { required: typeof input?.required === "boolean" ? input?.required : Boolean(input?.required) }),
  } as unknown as RequestBodyObject;
}